export type StreamEvent = {
  event: string;
  data: unknown;
};

export type StreamHandlers = {
  onEvent?: (eventName: string, data: unknown) => void;
  onError?: (message: string, code?: string, feature?: string) => void;
};

export async function streamPost(
  url: string,
  token: string,
  body: unknown,
  handlers: StreamHandlers
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    handlers.onError?.("Lost connection to the server.");
    return;
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code: string | undefined;
    let feature: string | undefined;
    try {
      const errorBody = await response.json();
      const detail = errorBody?.detail;
      if (typeof detail === "object" && detail !== null) {
        message = detail?.message ?? message;
        code = detail?.code;
        feature = detail?.feature;
      } else if (typeof detail === "string") {
        message = detail;
      }
    } catch {
      // ignore parse errors
    }
    handlers.onError?.(String(message), code, feature);
    return;
  }

  if (!response.body) {
    handlers.onError?.("Server returned an empty response.");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const lines = block.split("\n");
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataLines.push(line.slice(6));
          }
        }
        if (dataLines.length === 0) {
          continue;
        }
        let parsed: unknown = dataLines.join("\n");
        try {
          parsed = JSON.parse(dataLines.join("\n"));
        } catch {
          // keep raw text
        }
        handlers.onEvent?.(eventName, parsed);
      }
    }
  } catch {
    handlers.onError?.("Lost connection while streaming.");
  }
}