const form = document.getElementById('chat-form');
const input = document.getElementById('user-input');
const chatBox = document.getElementById('chat-box');

// Stores the conversation history for multi-turn chats
const conversation = [];

// Helper function to append a message to the chat box
function appendMessage(sender, text) {
  const msg = document.createElement('div');
  msg.classList.add('message', sender);
  msg.textContent = text;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
}

// Handle form submission and send messages to backend API
form.addEventListener('submit', async function (e) {
  e.preventDefault();

  const userMessage = input.value.trim();
  if (!userMessage) return;

  // 1. Add user message to UI and conversation history
  appendMessage('user', userMessage);
  conversation.push({ role: 'user', text: userMessage });

  // Clear input field and temporarily disable controls
  input.value = '';
  input.disabled = true;
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;

  // 2. Show temporary "Thinking..." bot message
  const thinkingMessage = appendMessage('bot', 'Thinking...');

  try {
    // 3. Send POST request to /api/chat with conversation array
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ conversation })
    });

    if (!response.ok) {
      throw new Error(`Server returned status: ${response.status}`);
    }

    const data = await response.json();

    // 4. Replace "Thinking..." message with the AI's reply
    if (data && typeof data.result === 'string' && data.result.trim()) {
      thinkingMessage.textContent = data.result;
      conversation.push({ role: 'model', text: data.result });
    } else {
      thinkingMessage.textContent = 'Sorry, no response received.';
      conversation.pop(); // Remove unanswered prompt from history
    }
  } catch (error) {
    console.error('Chat error:', error);
    // 5. Display error message if request fails
    thinkingMessage.textContent = 'Failed to get response from server.';
    conversation.pop(); // Remove unanswered prompt from history
  } finally {
    // Re-enable form controls and refocus input
    input.disabled = false;
    if (submitButton) submitButton.disabled = false;
    input.focus();
    chatBox.scrollTop = chatBox.scrollHeight;
  }
});
