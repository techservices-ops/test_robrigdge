import React, { useState, useRef, useEffect } from 'react';
import './ChatWidget.css';


const ChatWidget = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { text: "Hi! I am the RoBridge Assistant. How can I help you?", isBot: true }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // You might want to get the token or user id if needed for the backend
  // const { token } = useAuth();

  const toggleChat = () => setIsOpen(!isOpen);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { text: userMessage, isBot: false }]);
    setIsLoading(true);

    try {
      // In development, assume Python server is on port 8000
      // In production, this would be your deployed backend URL
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

      const response = await fetch(`${API_URL}/api/demo-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 'Authorization': `Bearer ${token}` // If your backend needs auth
        },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();
      setMessages(prev => [...prev, { text: data.reply, isBot: true }]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages(prev => [...prev, {
        text: "Sorry, I am having trouble connecting to the server.",
        isBot: true,
        isError: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`chat-widget-container ${isOpen ? 'open' : ''}`}>
      {/* Floating Button */}
      {!isOpen && (
        <button className="chat-widget-button" onClick={toggleChat} aria-label="Open Chat">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="chat-widget-window">
          <div className="chat-widget-header">
            <h3>RoBridge Assistant</h3>
            <button className="chat-close-button" onClick={toggleChat}>&times;</button>
          </div>

          <div className="chat-widget-messages">
            {messages.map((msg, index) => (
              <div key={index} className={`chat-message ${msg.isBot ? 'bot-message' : 'user-message'} ${msg.isError ? 'error-message' : ''}`}>
                <div className="message-content">
                  {msg.text}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="chat-message bot-message">
                <div className="message-content typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="chat-widget-input-area" onSubmit={handleSend}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              disabled={isLoading}
            />
            <button type="submit" disabled={isLoading || !input.trim()}>
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default ChatWidget;