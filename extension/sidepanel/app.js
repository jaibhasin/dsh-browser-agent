const composer = document.querySelector("#composer");
const prompt = document.querySelector("#prompt");
const messages = document.querySelector("#messages");

function resizePrompt() {
  prompt.style.height = "auto";
  prompt.style.height = `${Math.min(prompt.scrollHeight, 120)}px`;
}

function addUserMessage(text) {
  const message = document.createElement("article");
  message.className = "message message-user";

  const content = document.createElement("div");
  content.className = "message-content";

  const body = document.createElement("p");
  body.textContent = text;
  content.append(body);

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "Y";

  message.append(content, avatar);
  messages.append(message);
  message.scrollIntoView({ behavior: "smooth", block: "end" });
}

prompt.addEventListener("input", resizePrompt);

prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = prompt.value.trim();

  if (!text) {
    return;
  }

  addUserMessage(text);
  prompt.value = "";
  resizePrompt();
});

resizePrompt();
