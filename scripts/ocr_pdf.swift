// ocr_pdf.swift - offline OCR helper for scripts/mine_books.py
//
// WHY THIS EXISTS
// ---------------
// "Psychology in Chess" (Krogius, 1976) is an image-only scan: every page is a
// stack of CCITT-fax strips with no text layer, so pypdf extracts nothing from
// it. macOS ships the Vision framework and the Swift toolchain, so we can OCR
// the scan *locally, for free, offline* - no install, no licence, no API key,
// no network and no new Python dependency. PyMuPDF stays forbidden (AGPL).
//
// This is a developer-only authoring aid. It is invoked by
// scripts/mine_books.py, which pipes the text through the same
// clean -> chunk -> BM25 pipeline used for the text-layer book. Nothing here
// ever ships or reaches a user.
//
// USAGE
// -----
//   ocr_pdf <pdf> [startPage0] [count] [scale] [columns]
//
//   startPage0  zero-based index of the first page to OCR (default 0)
//   count       number of pages to OCR (default 1)
//   scale       render scale for the page raster (default 3.0)
//   columns     auto | off (default auto)
//
// OUTPUT
// ------
// One "=== page N ===" marker per page (N is the 1-based PDF page number,
// matching the locators mine_books.py stores in the index), followed by a
// "##layout single|two-column" annotation for that page, followed by the
// recognised text, one observation per line. The marker is the contract with
// the caller: it is how OCR text is mapped back to page numbers. The layout
// annotation is how the caller reports, every build, what fraction of the scan
// the column detector could handle - so a silent regression in the column
// logic shows up as a number rather than as garbled prose.
//
// On two-column pages a line containing only a form feed (\f, U+000C) is
// emitted between the two columns. mine_books.py splits on it, cleans and
// re-flows each column separately, and concatenates them in reading order.
// The sentinel also stops the caller's de-hyphenation pass from stitching a
// hyphen at the bottom of column 1 onto the first word of column 2.
//
// Progress/diagnostics go to stderr so stdout stays machine-parseable.
//
// COLUMN HANDLING
// ---------------
// Vision reads a two-column page across the full width on some pages,
// interleaving the columns ("In the first, / THE C / the opponent's possible
// threats (c"). To fix that we classify the page layout ourselves:
//
//   * Only *column-width* observations (width <= COLUMN_LINE_MAX_WIDTH) are
//     used to find the gutter, so a full-width heading that legitimately spans
//     both columns cannot mask the gutter.
//   * We scan candidate splits across the middle 40% of the page and keep the
//     one that puts the most lines entirely on one side while minimising lines
//     that straddle it, then require both sides to be tall, wide and
//     well-populated. A single-column page has lines straddling every central
//     split, so it is rejected.
//   * Observations are then emitted column 1 top-to-bottom, then column 2.
//
// Deviation from Vision's own order is the whole point; the residual
// limitation is documented in mine_books.py.

import Foundation
import PDFKit
import Vision
import CoreGraphics

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

let DEFAULT_SCALE: CGFloat = 3.0

/// A line wider than this is treated as spanning the gutter (headings,
/// captions) and is excluded when looking for the gutter, but still emitted.
let COLUMN_LINE_MAX_WIDTH: CGFloat = 0.55
/// A line narrower than this is stray glyph noise, not column content.
let COLUMN_LINE_MIN_WIDTH: CGFloat = 0.05
/// The gutter must sit inside this horizontal band of a normal page.
let CENTER_BAND_LOW: CGFloat = 0.32
let CENTER_BAND_HIGH: CGFloat = 0.68
/// Both columns must hold at least this many lines.
let MIN_COLUMN_LINES = 3
/// Both columns must each reach at least this many "real width" lines.
let MIN_COLUMN_WIDE_LINES = 3
let COLUMN_WIDE_LINE: CGFloat = 0.18
/// The taller side must span at least this fraction of the page height. The
/// shorter side only has to be non-trivial: a chapter opener can put a short
/// text block on one page of the spread and a full column on the other. The
/// crossing test below is the real discriminator between one and two columns;
/// these span floors are a secondary sanity check.
let MIN_COLUMN_SPAN_MAJOR: CGFloat = 0.45
let MIN_COLUMN_SPAN_MINOR: CGFloat = 0.10
/// Step used when scanning candidate gutter positions.
let GUTTER_STEP: CGFloat = 0.002
/// Fraction of column-width lines allowed to straddle the chosen gutter.
let GUTTER_CROSSING_TOLERANCE = 0.05

let DEBUG = ProcessInfo.processInfo.environment["OCR_DEBUG"] != nil

// --------------------------------------------------------------------------
// Model
// --------------------------------------------------------------------------

/// One recognised text line, in Vision's normalised page coordinates
/// (origin bottom-left, values 0...1).
struct RecognizedLine {
    let text: String
    let minX: CGFloat
    let maxX: CGFloat
    let minY: CGFloat
    let maxY: CGFloat

    var width: CGFloat { maxX - minX }
    var centerX: CGFloat { (minX + maxX) / 2 }
    var centerY: CGFloat { (minY + maxY) / 2 }
}

func log(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

// --------------------------------------------------------------------------
// Column detection
// --------------------------------------------------------------------------

func spread(_ lines: [RecognizedLine]) -> CGFloat {
    guard let low = lines.map(\.minY).min(), let high = lines.map(\.maxY).max() else {
        return 0
    }
    return high - low
}

/// Return the x of the gutter when the page looks two-column, else nil.
///
/// The rule: among column-width lines, find a central split that has (nearly)
/// no line crossing it and leaves at least `MIN_COLUMN_LINES` lines on each
/// side, with the taller side spanning `MIN_COLUMN_SPAN_MAJOR` of the page and
/// the shorter side at least `MIN_COLUMN_SPAN_MINOR`. The crossing test is the
/// real discriminator - on a genuine single column every line crosses any
/// central split - and the span floors are a secondary sanity check that also
/// tolerates a chapter opener whose text block is short on one side. The
/// balancing split (most lines on the smaller side) is preferred so we land in
/// the middle of the gutter rather than on its edge.
func detectGutter(_ lines: [RecognizedLine]) -> CGFloat? {
    let candidates = lines.filter {
        $0.width >= COLUMN_LINE_MIN_WIDTH && $0.width <= COLUMN_LINE_MAX_WIDTH
    }
    guard candidates.count >= MIN_COLUMN_LINES * 2 else {
        if DEBUG { log("  columns: only \(candidates.count) column-width lines - single") }
        return nil
    }

    let tolerance = max(1, Int(Double(candidates.count) * GUTTER_CROSSING_TOLERANCE))
    var bestSplit: CGFloat?
    var bestBalance = -1
    var bestReject: String?

    var split = CENTER_BAND_LOW
    while split <= CENTER_BAND_HIGH {
        let left = candidates.filter { $0.maxX <= split }
        let right = candidates.filter { $0.minX >= split }
        let crossing = candidates.count - left.count - right.count
        if crossing <= tolerance {
            let balance = min(left.count, right.count)
            if balance >= MIN_COLUMN_LINES && balance > bestBalance {
                let leftWide = left.filter { $0.width >= COLUMN_WIDE_LINE }.count
                let rightWide = right.filter { $0.width >= COLUMN_WIDE_LINE }.count
                let spanMajor = max(spread(left), spread(right))
                let spanMinor = min(spread(left), spread(right))
                if leftWide >= MIN_COLUMN_WIDE_LINES,
                   rightWide >= MIN_COLUMN_WIDE_LINES,
                   spanMajor >= MIN_COLUMN_SPAN_MAJOR,
                   spanMinor >= MIN_COLUMN_SPAN_MINOR {
                    bestBalance = balance
                    bestSplit = split
                } else {
                    bestReject = String(
                        format: "split=%.3f balance=%d crossing=%d wideL=%d wideR=%d spanMajor=%.2f spanMinor=%.2f",
                        split, balance, crossing, leftWide, rightWide, spanMajor, spanMinor
                    )
                }
            }
        }
        split += GUTTER_STEP
    }
    if let bestSplit {
        if DEBUG { log(String(format: "  columns: two-column at x=%.3f", bestSplit)) }
        return bestSplit
    }
    if DEBUG {
        log("  columns: single - best crossing-valid split rejected: \(bestReject ?? "none in band")")
    }
    return nil
}

/// Sort a single column top-to-bottom, then left-to-right, using a y bucket so
/// the comparator stays a valid strict weak ordering.
func sortColumn(_ lines: [RecognizedLine]) -> [RecognizedLine] {
    lines.sorted { a, b in
        let rowA = Int((a.centerY / 0.012).rounded())
        let rowB = Int((b.centerY / 0.012).rounded())
        if rowA != rowB { return rowA > rowB }
        return a.minX < b.minX
    }
}

/// Split the page into emission groups in reading order.
///
/// A line that straddles the gutter (a wide heading) is assigned to the column
/// that holds most of it, so a page-top heading still comes first.
func columnGroups(_ lines: [RecognizedLine], gutter: CGFloat?) -> [[RecognizedLine]] {
    guard let gutter else {
        return [sortColumn(lines)]
    }
    var left: [RecognizedLine] = []
    var right: [RecognizedLine] = []
    for line in lines {
        if line.maxX <= gutter {
            left.append(line)
        } else if line.minX >= gutter {
            right.append(line)
        } else if (gutter - line.minX) >= (line.maxX - gutter) {
            left.append(line)
        } else {
            right.append(line)
        }
    }
    return [sortColumn(left), sortColumn(right)].filter { !$0.isEmpty }
}

// --------------------------------------------------------------------------
// OCR
// --------------------------------------------------------------------------

func recognize(image: CGImage) -> [RecognizedLine] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]
    if #available(macOS 13.0, *) {
        request.revision = VNRecognizeTextRequestRevision3
    }
    do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    } catch {
        log("ocr_pdf: Vision failed: \(error)")
        return []
    }
    var lines: [RecognizedLine] = []
    for observation in request.results ?? [] {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let text = candidate.string
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
        let box = observation.boundingBox
        lines.append(
            RecognizedLine(
                text: text,
                minX: box.minX,
                maxX: box.maxX,
                minY: box.minY,
                maxY: box.maxY
            )
        )
    }
    return lines
}

/// Size of the page as it is *displayed*, i.e. with /Rotate taken into account.
///
/// The Krogius scan is stored as an A4 portrait page carrying `/Rotate 90`, so
/// the visible spread is landscape. Sizing the raster from the raw mediaBox
/// silently clips the right half of the image - which looks exactly like a
/// column-handling failure, so it is worth being explicit about.
func displaySize(_ page: PDFPage) -> CGSize {
    let bounds = page.bounds(for: .mediaBox)
    let rotation = ((page.rotation % 360) + 360) % 360
    if rotation == 90 || rotation == 270 {
        return CGSize(width: bounds.height, height: bounds.width)
    }
    return bounds.size
}

func render(page: PDFPage, scale: CGFloat) -> CGImage? {
    let size = displaySize(page)
    let width = Int(size.width * scale)
    let height = Int(size.height * scale)
    guard width > 0, height > 0 else { return nil }
    guard let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ) else { return nil }
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: context)
    return context.makeImage()
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    log("usage: ocr_pdf <pdf> [startPage0] [count] [scale] [auto|off]")
    exit(2)
}

let pdfURL = URL(fileURLWithPath: arguments[1])
let startPage = arguments.count > 2 ? (Int(arguments[2]) ?? 0) : 0
let pageCount = arguments.count > 3 ? (Int(arguments[3]) ?? 1) : 1
let scale = arguments.count > 4 ? (CGFloat(Double(arguments[4]) ?? 3.0) ?? DEFAULT_SCALE) : DEFAULT_SCALE
let columnMode = arguments.count > 5 ? arguments[5] : "auto"

guard let document = PDFDocument(url: pdfURL) else {
    log("ocr_pdf: cannot open \(pdfURL.path)")
    exit(1)
}

let lastPage = min(startPage + max(pageCount, 1), document.pageCount)
var twoColumnPages = 0

for index in startPage..<lastPage {
    guard let page = document.page(at: index) else { continue }
    guard let image = render(page: page, scale: scale) else {
        log("ocr_pdf: page \(index + 1) failed to render")
        continue
    }
    let lines = recognize(image: image)
    let gutter = columnMode == "off" ? nil : detectGutter(lines)
    if gutter != nil { twoColumnPages += 1 }
    let groups = columnGroups(lines, gutter: gutter)

    print("=== page \(index + 1) ===")
    print("##layout \(gutter == nil ? "single" : "two-column")")
    for (groupIndex, group) in groups.enumerated() {
        if groupIndex > 0 {
            print("\u{000C}")
        }
        for line in group {
            print(line.text)
        }
    }
}

log("ocr_pdf: pages \(startPage + 1)-\(lastPage) done (\(twoColumnPages) two-column)")
