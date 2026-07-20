const form = document.getElementById("form");
const btn = document.getElementById("submit");
const status = document.getElementById("status");

function setStatus(msg, kind) {
  status.textContent = msg;
  status.className = "status" + (kind ? " " + kind : "");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("");

  const data = Object.fromEntries(new FormData(form).entries());

  if (!data.name?.trim() || !data.message?.trim()) {
    setStatus("Name and message are required.", "err");
    return;
  }

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Sending…";

  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const out = await res.json().catch(() => ({}));

    if (res.ok && out.ok) {
      form.reset();
      setStatus("Sent — thanks! 🎉", "ok");
    } else {
      setStatus(out.error || "Something went wrong. Try again.", "err");
    }
  } catch {
    setStatus("Network error. Check your connection and retry.", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});
