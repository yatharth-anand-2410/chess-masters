import { ImageResponse } from "next/og";

export const alt =
  "Chessmasters · AI Chess Game Analyzer for Chess.com and Lichess";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: "#0c1214",
          backgroundImage:
            "radial-gradient(900px 420px at 78% -10%, rgba(201,153,63,0.22), transparent 62%)",
          color: "#ece6d8",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            color: "#c9993f",
            fontSize: 26,
            letterSpacing: 6,
            textTransform: "uppercase",
          }}
        >
          AI Chess Game Analyzer
        </div>
        <div
          style={{
            marginTop: 26,
            fontSize: 96,
            fontWeight: 700,
            color: "#f3ecdc",
            letterSpacing: -2,
          }}
        >
          Chessmasters
        </div>
        <div
          style={{
            marginTop: 26,
            fontSize: 40,
            color: "#c9993f",
            fontWeight: 600,
          }}
        >
          Turn a finished game into your next lesson.
        </div>
        <div
          style={{
            marginTop: 22,
            fontSize: 28,
            color: "#8b9c9c",
          }}
        >
          Plain-English coaching reports for Chess.com and Lichess
        </div>
        <div
          style={{
            marginTop: 44,
            width: 220,
            height: 6,
            background: "#c9993f",
            borderRadius: 3,
          }}
        />
      </div>
    ),
    size
  );
}
