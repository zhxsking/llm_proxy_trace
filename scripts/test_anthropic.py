"""
LPT 端对端测试脚本 — Anthropic (claude) 通过代理发送请求，验证 thinking + 正文透传

用法：
  python scripts/test_anthropic.py
  IS_STREAM=false python scripts/test_anthropic.py
"""

import os
import anthropic

BASE_URL = os.getenv("LPT_BASE_URL", "http://localhost:19900")
MODEL    = os.getenv("LPT_MODEL",    "claude-sonnet-4-6")  # claude-sonnet-4-6 / claude-opus-4-6
STREAM   = os.getenv("IS_STREAM", "true").lower() != "false"

client = anthropic.Anthropic(
    api_key=os.getenv("ANTHROPIC_API_KEY", "any"),
    base_url=BASE_URL,
)

THINKING_CONFIG = {
    "type": "adaptive",
    "effort": "low",        # low / medium / high
    "display": "summarized", # "summarized" 返回思考摘要；"omitted" 不返回
}

MESSAGES = [
    {"role": "user", "content": "先思考一下，然后用一句话介绍你自己。"},
]

print(f"=== LPT Anthropic 测试  model={MODEL}  stream={STREAM} ===\n")

if STREAM:
    current_block_type = None
    thinking_started = False
    text_started = False

    with client.messages.stream(
        model=MODEL,
        max_tokens=16000,
        thinking=THINKING_CONFIG,
        messages=MESSAGES,
    ) as stream:
        for event in stream:
            if event.type == "content_block_start":
                current_block_type = event.content_block.type
                if current_block_type == "thinking" and not thinking_started:
                    print("--- 思考过程 ---")
                    thinking_started = True
                elif current_block_type == "text" and not text_started:
                    print("\n--- 回答 ---")
                    text_started = True

            elif event.type == "content_block_delta":
                delta = event.delta
                if delta.type == "thinking_delta":
                    print(delta.thinking, end="", flush=True)
                elif delta.type == "text_delta":
                    print(delta.text, end="", flush=True)

        msg = stream.get_final_message()
        u = msg.usage
        print(f"\n\nTokens: input={u.input_tokens}  output={u.output_tokens}")

else:
    resp = client.messages.create(
        model=MODEL,
        max_tokens=16000,
        thinking=THINKING_CONFIG,
        messages=MESSAGES,
    )
    for block in resp.content:
        if block.type == "thinking":
            print("--- 思考过程 ---")
            print(block.thinking or "[thinking omitted]")
        elif block.type == "text":
            print("\n--- 回答 ---")
            print(block.text)
    u = resp.usage
    print(f"\nTokens: input={u.input_tokens}  output={u.output_tokens}")