import React, { useState, useRef, useEffect } from 'react';
import { FaBrain, FaTimes, FaPaperPlane, FaRobot } from 'react-icons/fa';
import './IMSChatBot.css';

import { useWorkspace } from '../contexts/WorkspaceContext';

// ── Suggested quick prompts ───────────────────────────────────────────────────
const SUGGESTIONS = [
  "What's critically low?",
  "List items by category",
  "Which items have no category?",
  "Storage usage",
];

// ── Component ─────────────────────────────────────────────────────────────────
const IMSChatBot = () => {
  const { imsFetch, activeWorkspaceId } = useWorkspace();
  const [catalogContext, setCatalogContext] = useState("");

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      text: "👋 Welcome! I'm your **IMS AI Assistant**. How can I help you manage your inventory today?",
      isBot: true,
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const isTypingRef = useRef(false);
  const messagesEndRef = useRef(null);

  // Fetches latest catalog data
  const getLatestCatalogContext = async () => {
    try {
      const mastersRes = await imsFetch('/api/ims/masters');
      const mastersData = await mastersRes.json();
      
      if (mastersData.success && mastersData.masters.length > 0) {
        let allItems = [];
        for (const master of mastersData.masters) {
          const itemsRes = await imsFetch(`/api/ims/masters/${master.id}/items`);
          const itemsData = await itemsRes.json();
          if (itemsData.success) {
            allItems = [...allItems, ...itemsData.items];
          }
        }
        
        let totalStock = 0;
        const contextString = allItems.map(item => {
          totalStock += parseInt(item.stock) || 0;
          return `Barcode: ${item.barcode}, Name: ${item.name}, Stock: ${item.stock}, Category: ${item.category || 'N/A'}`;
        }).join('\n');
        
        const maxCapacity = 15000;
        const usagePercent = ((totalStock / maxCapacity) * 100).toFixed(1);
        return `WAREHOUSE STATUS:\nTotal Storage Capacity: ${maxCapacity} units\nCurrent Usage: ${totalStock} units (${usagePercent}% full)\n\nPRODUCT LIST:\n${contextString}`;
      }
      return "No catalogs found.";
    } catch (err) {
      console.error("Failed to load catalog context for AI:", err);
      return "Error fetching catalog.";
    }
  };

  useEffect(() => {
    if (!isOpen || !activeWorkspaceId) return;
    // Initial fetch to populate context when chatbot opens
    getLatestCatalogContext().then(ctx => setCatalogContext(ctx));
  }, [isOpen, activeWorkspaceId, imsFetch]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const sendMessage = async (text) => {
    if (isTypingRef.current) return; // Synchronous lock to prevent React batching double-clicks
    isTypingRef.current = true;
    
    const userText = text || input.trim();
    if (!userText) {
      isTypingRef.current = false;
      return;
    }
    
    setInput('');
    setMessages(prev => [...prev, { text: userText, isBot: false }]);
    setIsTyping(true);

    try {
      // 🚨 Ensure we always fetch the absolutely latest catalog data before answering!
      const freshestContext = await getLatestCatalogContext();
      setCatalogContext(freshestContext);

      const AI_API_URL = process.env.REACT_APP_AI_API_URL || 'http://localhost:8000';
      
      const response = await fetch(`${AI_API_URL}/api/ims-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          message: userText,
          catalog_context: freshestContext
        }),
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const data = await response.json();
      setMessages(prev => [...prev, { text: data.reply, isBot: true }]);
    } catch (error) {
      console.error("AI Chat error:", error);
      setMessages(prev => [...prev, { 
        text: "I am having trouble connecting to the AI server. Is the Python backend running?", 
        isBot: true 
      }]);
    } finally {
      setIsTyping(false);
      isTypingRef.current = false;
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage();
  };

  // Render markdown-style bold (**text**)
  const renderText = (text) =>
    text.split(/\*\*(.*?)\*\*/g).map((part, i) =>
      i % 2 === 1 ? <strong key={i}>{part}</strong> : part
    );

  const renderMessage = (text) =>
    text.split('\n').map((line, i) => (
      <span key={i}>
        {renderText(line)}
        {i < text.split('\n').length - 1 && <br />}
      </span>
    ));

  return (
    <div className={`ims-chatbot-container ${isOpen ? 'open' : ''}`}>
      {/* Floating Button */}
      {!isOpen && (
        <button className="ims-chatbot-fab" onClick={() => setIsOpen(true)} title="Ask IMS AI">
          <FaBrain className="fab-icon" />
          <span className="fab-pulse"></span>
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="ims-chatbot-window">
          {/* Header */}
          <div className="ims-chatbot-header">
            <div className="chatbot-header-left">
              <div className="chatbot-avatar"><FaRobot /></div>
              <div>
                <div className="chatbot-title">IMS AI Assistant</div>
                <div className="chatbot-status"><span className="status-dot"></span> Online · Inventory Mode</div>
              </div>
            </div>
            <button className="chatbot-close" onClick={() => setIsOpen(false)}><FaTimes /></button>
          </div>

          {/* Messages */}
          <div className="ims-chatbot-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`chat-bubble ${msg.isBot ? 'bot' : 'user'}`}>
                {msg.isBot && <div className="bubble-avatar"><FaRobot /></div>}
                <div className="bubble-text">{renderMessage(msg.text)}</div>
              </div>
            ))}
            {isTyping && (
              <div className="chat-bubble bot">
                <div className="bubble-avatar"><FaRobot /></div>
                <div className="bubble-text typing-dots">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestions */}
          <div 
            className="ims-chatbot-suggestions"
            onMouseDown={(e) => {
              const slider = e.currentTarget;
              slider.isDown = true;
              slider.startX = e.pageX - slider.offsetLeft;
              slider.scrollLeftStart = slider.scrollLeft;
              slider.style.cursor = 'grabbing';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.isDown = false;
              e.currentTarget.style.cursor = 'grab';
            }}
            onMouseUp={(e) => {
              e.currentTarget.isDown = false;
              e.currentTarget.style.cursor = 'grab';
            }}
            onMouseMove={(e) => {
              const slider = e.currentTarget;
              if (!slider.isDown) return;
              e.preventDefault();
              const x = e.pageX - slider.offsetLeft;
              const walk = (x - slider.startX) * 2; // Scroll speed multiplier
              slider.scrollLeft = slider.scrollLeftStart - walk;
            }}
            style={{ cursor: 'grab' }}
          >
            {SUGGESTIONS.map((s, i) => (
              <button key={i} className="suggestion-chip" onClick={() => sendMessage(s)}>
                {s}
              </button>
            ))}
          </div>

          {/* Input */}
          <form className="ims-chatbot-input" onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder="Ask about stock, alerts, forecasts..."
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={isTyping}
              autoFocus
            />
            <button type="submit" disabled={isTyping || !input.trim()}>
              <FaPaperPlane />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default IMSChatBot;
