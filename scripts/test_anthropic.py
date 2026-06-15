"""
LPT 端对端测试脚本 — Anthropic (claude) 通过代理发送请求，验证 thinking + 正文透传

用法：
  python scripts/test_anthropic.py
  IS_STREAM=false python scripts/test_anthropic.py
"""

import os
import anthropic

BASE_URL = os.getenv("LPT_BASE_URL", "http://localhost:19900")
MODEL    = os.getenv("LPT_MODEL",    "claude-sonnet-4-6")
STREAM   = os.getenv("IS_STREAM", "true").lower() != "false"

client = anthropic.Anthropic(
    api_key=os.getenv("ANTHROPIC_API_KEY", "any"),
    base_url=BASE_URL,
)

MESSAGES = [
    {"role": "user", "content": "用一句话介绍你自己。"},
]

print(f"=== LPT Anthropic 测试  model={MODEL}  stream={STREAM} ===\n")

if STREAM:
    thinking_done = False
    print("--- 思考过程 ---")
    with client.messages.stream(
        model=MODEL,
        max_tokens=16000,
        thinking={"type": "enabled", "budget_tokens": 10000},
        messages=MESSAGES,
    ) as stream:
        for event in stream:
            # content_block_delta 事件
            if event.type == "content_block_delta":
                delta = event.delta
                if delta.type == "thinking_delta":
                    print(delta.thinking, end="", flush=True)
                elif delta.type == "text_delta":
                    if not thinking_done:
                        print("\n--- 回答 ---")
                        thinking_done = True
                    print(delta.text, end="", flush=True)

        # 最终 usage
        msg = stream.get_final_message()
        u = msg.usage
        print(f"\n\nTokens: input={u.input_tokens}  output={u.output_tokens}")
else:
    resp = client.messages.create(
        model=MODEL,
        max_tokens=16000,
        thinking={"type": "enabled", "budget_tokens": 10000},
        messages=MESSAGES,
    )
    for block in resp.content:
        if block.type == "thinking":
            print("--- 思考过程 ---")
            print(block.thinking)
        elif block.type == "text":
            print("--- 回答 ---")
            print(block.text)
    u = resp.usage
    print(f"\nTokens: input={u.input_tokens}  output={u.output_tokens}")
