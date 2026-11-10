// main.js 和 guide.js 共用的显示工具；只格式化文字与复制公开字段，不判断链上交易资格。

// Fixed UTC display so the same deadline reads identically on every demo machine.
export function formatUtc(unixSeconds) {
  const date = new Date(Number(unixSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}


export function formatDeadline(unixSeconds) {
  return formatUtc(unixSeconds) + " (Unix " + String(unixSeconds) + ")";
}

// Seconds -> H:MM:SS; negative values are shown as elapsed time by the caller.
export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Math.abs(Number(totalSeconds))));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
}

// Local-clock countdown text for an Active lock. The chain timestamp at the next read stays authoritative.
export function countdownText(timelock) {
  const remaining = Number(timelock) - Math.floor(Date.now() / 1000);
  if (remaining > 0) {
    return { expired: false, text: "Expires in " + formatDuration(remaining) + " by this device's clock. Chain time at the next read decides." };
  }
  return { expired: true, text: "Deadline passed " + formatDuration(remaining) + " ago by this device's clock. Read Both Locks to confirm refund eligibility." };
}

const HEX_VALUE = /^0x[0-9a-fA-F]{40,}$/;

export function looksCopyable(value) {
  return HEX_VALUE.test(String(value));
}

// Small "Copy" control placed next to IDs, hashes and addresses. Uses data attributes so one delegated handler serves every button.
export function copyButton(text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button";
  button.dataset.copyText = String(text);
  button.setAttribute("aria-label", "Copy " + String(text).slice(0, 10) + "… to clipboard");
  button.textContent = "Copy";
  return button;
}

// Fill a <dl> with [label, value] rows; long hex values get a copy button.
export function fillRecord(list, rows) {
  list.replaceChildren();
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = String(value);
    if (looksCopyable(value)) detail.append(" ", copyButton(value));
    list.append(term, detail);
  }
}

// One listener for all copy buttons, including ones created later. Buttons may point at another element via data-copy-target.
export function attachCopyHandler(root = document) {
  root.addEventListener("click", async (event) => {
    const button = event.target.closest(".copy-button");
    if (!button) return;
    const target = button.dataset.copyTarget ? document.getElementById(button.dataset.copyTarget) : null;
    const text = target ? ("value" in target ? target.value : target.textContent).trim() : button.dataset.copyText || "";
    const original = "Copy";
    if (!text || !text.startsWith("0x")) {
      flash(button, "Nothing to copy", original);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      flash(button, "Copied", original);
    } catch {
      flash(button, "Copy failed", original);
    }
  });
}

function flash(button, label, original) {
  button.textContent = label;
  button.dataset.state = label === "Copied" ? "done" : "error";
  setTimeout(() => { button.textContent = original; delete button.dataset.state; }, 1500);
}
