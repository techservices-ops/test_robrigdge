import React, { useState, useRef, useEffect } from 'react';
import { FaBrain, FaTimes, FaPaperPlane, FaRobot } from 'react-icons/fa';
import './IMSChatBot.css';

// ── Mock inventory knowledge base ────────────────────────────────────────────
const inventory = {
  totalSKUs: 1248,
  movements: 347,
  storage: { used: 412, total: 1024, unit: 'MB' },
  lowStock: [
    { name: 'Paracetamol 500mg (PACK)', stock: 3, min: 20, type: 'critical', expiry: '2026-04-20' },
    { name: 'N95 Masks (Pack of 10)', stock: 2, min: 50, type: 'critical', expiry: null },
    { name: 'Amoxicillin 250mg (CASE)', stock: 8, min: 15, type: 'warning', expiry: '2026-05-01' },
    { name: 'Hand Sanitizer 500ml', stock: 12, min: 25, type: 'warning', expiry: null },
    { name: 'Vitamin C Tablets (BOX)', stock: 45, min: 10, type: 'expiry', expiry: '2026-04-18' },
  ],
  topMovers: [
    { name: 'Paracetamol 500mg', movement: 342 },
    { name: 'Hand Sanitizer', movement: 298 },
    { name: 'N95 Masks', movement: 256 },
    { name: 'Amoxicillin 250mg', movement: 189 },
    { name: 'Vitamin C Tablets', movement: 145 },
  ],
  wip: [
    { order: 'PRD-1049', product: 'Vitamin C Tablets (Batch A)', progress: 75, status: 'In Progress', due: 'Today' },
    { order: 'PRD-1050', product: 'Paracetamol 500mg (Batch B)', progress: 30, status: 'Blending', due: 'Tomorrow' },
    { order: 'PRD-1051', product: 'Sanitizer 500ml', progress: 95, status: 'Packaging', due: 'Today' },
  ],
  forecast: [
    { product: 'Latex Gloves (M)', daysLeft: 4, note: 'Consumption spiked 40%' },
    { product: 'Amoxicillin 250mg', daysLeft: 12, note: 'Stable flow' },
    { product: 'Vitamin C Tablets', daysLeft: 25, note: 'Overstocked' },
  ],
};

// ── Smart response engine ─────────────────────────────────────────────────────
function generateResponse(query) {
  const q = query.toLowerCase();

  // Greetings
  if (/^(hi|hello|hey|good morning|good evening|howdy)/.test(q)) {
    return `👋 Hello! I'm your **IMS AI Assistant**. I can answer questions about stock levels, alerts, movements, production orders, and forecasts.\n\nTry asking:\n• "What items are critically low?"\n• "Which products expire soon?"\n• "What's the top moving product?"`;
  }

  // Help
  if (/\b(help|what can you|commands|capabilities)\b/.test(q)) {
    return `Here's what I can help you with:\n\n📦 **Stock & Inventory**\n• "How many SKUs do we have?"\n• "What's the stock level for [product]?"\n\n🚨 **Alerts**\n• "What's critically low?"\n• "Show all alerts"\n\n📈 **Movements & Forecast**\n• "Top moving products"\n• "What will run out this week?"\n\n🏭 **Production**\n• "What's in production?"\n• "Show WIP orders"`;
  }

  // Storage
  if (/\b(storage|quota|disk|space|memory|usage)\b/.test(q)) {
    const pct = ((inventory.storage.used / inventory.storage.total) * 100).toFixed(1);
    return `💾 **Storage Quota**\n\nUsed: **${inventory.storage.used} MB** of ${inventory.storage.total} MB (${pct}% consumed).\n\nAt current ingestion rates, storage capacity should remain stable for the next 45+ days.`;
  }

  // Critical alerts only
  if (/\b(critical|urgent|emergency|severe)\b/.test(q)) {
    const critical = inventory.lowStock.filter(i => i.type === 'critical');
    return `🔴 **Critical Stock Alerts** (${critical.length} items)\n\n${critical.map(i =>
      `• **${i.name}** — Stock: ${i.stock} (min: ${i.min})${i.expiry ? ` ⚠️ Expires: ${i.expiry}` : ''}`
    ).join('\n')}\n\nImmediate reorder is recommended for these items.`;
  }

  // All alerts / low stock
  if (/\b(low|alert|alerts|stock alert|warning|shortage)\b/.test(q)) {
    const critCount = inventory.lowStock.filter(i => i.type === 'critical').length;
    const warnCount = inventory.lowStock.filter(i => i.type === 'warning').length;
    const expCount = inventory.lowStock.filter(i => i.type === 'expiry').length;
    return `🚨 **Active Stock Alerts** (${inventory.lowStock.length} total)\n\n${inventory.lowStock.map(i => {
      const icon = i.type === 'critical' ? '🔴' : i.type === 'warning' ? '🟡' : '🔵';
      return `${icon} **${i.name}** — Current: ${i.stock} / Min: ${i.min}${i.expiry ? ` | Expires: ${i.expiry}` : ''}`;
    }).join('\n')}\n\n**Summary:** ${critCount} Critical · ${warnCount} Warning · ${expCount} Expiry risk`;
  }

  // Expiry
  if (/\b(expir|expire|expiry|expiring|date)\b/.test(q)) {
    const expiring = inventory.lowStock.filter(i => i.expiry);
    return `📅 **Expiry Risk Items** (${expiring.length} products)\n\n${expiring.map(i =>
      `• **${i.name}** — Expires: **${i.expiry}** | Stock: ${i.stock} units`
    ).join('\n')}\n\nFEFO rotation is active. Ensure these are picked before newer batches.`;
  }

  // Top movers
  if (/\b(top|moving|fastest|most|popular|sold|movement)\b/.test(q)) {
    return `📈 **Top Moving Products This Week**\n\n${inventory.topMovers.map((item, i) =>
      `${i + 1}. **${item.name}** — ${item.movement} units moved`
    ).join('\n')}\n\nTotal movements today: **${inventory.movements}** transactions.`;
  }

  // Forecast / will run out
  if (/\b(forecast|run out|deplet|predict|soon|week|days)\b/.test(q)) {
    return `🔮 **Stock Forecast & Shortage Radar**\n\n${inventory.forecast.map(f => {
      const icon = f.daysLeft <= 7 ? '🔴' : f.daysLeft <= 14 ? '🟡' : '🟢';
      return `${icon} **${f.product}** — ${f.daysLeft} days left | ${f.note}`;
    }).join('\n')}\n\n⚠️ **Latex Gloves (M)** requires urgent attention — only 4 days of stock remaining.`;
  }

  // Production / WIP
  if (/\b(production|wip|workflow|batch|order|prd|manufactur)\b/.test(q)) {
    return `🏭 **Active Production Orders (WIP)**\n\n${inventory.wip.map(w =>
      `• **${w.order}** — ${w.product}\n  Progress: ${w.progress}% | Status: ${w.status} | Due: **${w.due}**`
    ).join('\n\n')}\n\n${inventory.wip.filter(w => w.due === 'Today').length} order(s) due today.`;
  }

  // SKU count / total
  if (/\b(sku|total|how many|count|catalog|item)\b/.test(q)) {
    return `📦 **Inventory Summary**\n\n• Total Active SKUs: **${inventory.totalSKUs.toLocaleString()}**\n• Movements today: **${inventory.movements}** transactions\n• Active alerts: **${inventory.lowStock.length}** items need attention\n• Active WIP orders: **${inventory.wip.length}**`;
  }

  // Paracetamol specific
  if (/paracetamol/.test(q)) {
    const item = inventory.lowStock.find(i => i.name.toLowerCase().includes('paracetamol'));
    return `💊 **Paracetamol 500mg (PACK)**\n\n• Current Stock: **${item.stock} units** (critically below minimum of ${item.min})\n• Expiry Date: **${item.expiry}** — FEFO priority active\n• Movement Rank: **#1** (${inventory.topMovers[0].movement} units this week)\n• Status: 🔴 **CRITICAL — Immediate reorder required**`;
  }

  // N95 specific
  if (/n95|mask/.test(q)) {
    const item = inventory.lowStock.find(i => i.name.toLowerCase().includes('n95'));
    return `😷 **N95 Masks (Pack of 10)**\n\n• Current Stock: **${item?.stock ?? 2} units** (critically below minimum of ${item?.min ?? 50})\n• Movement Rank: **#3** (${inventory.topMovers[2].movement} units this week)\n• Status: 🔴 **CRITICAL — Reorder immediately**`;
  }

  // Sanitizer specific
  if (/saniti|sanitizer/.test(q)) {
    const item = inventory.lowStock.find(i => i.name.toLowerCase().includes('saniti'));
    return `🧴 **Hand Sanitizer 500ml**\n\n• Current Stock: **${item?.stock ?? 12} units** (below minimum of ${item?.min ?? 25})\n• Movement: ${inventory.topMovers[1].movement} units this week (Rank #2)\n• Status: 🟡 **WARNING — Stock running low**`;
  }

  // Generic stock query for unknown product
  if (/\b(stock|level|inventory|how much|quantity|qty)\b/.test(q)) {
    return `🔍 I couldn't find a specific product match. Here's a quick overview:\n\n• ${inventory.lowStock.filter(i => i.type === 'critical').length} items at **CRITICAL** levels\n• ${inventory.lowStock.filter(i => i.type === 'warning').length} items at **WARNING** levels\n\nTry asking about a specific product name like "Paracetamol", "N95 Masks", or "Sanitizer" for detailed info.`;
  }

  // Fallback
  return `🤔 I'm not sure how to answer that specifically. I'm an **IMS inventory assistant** — try asking about:\n\n• Stock levels & alerts\n• Products expiring soon\n• Top moving items\n• Forecast & shortages\n• Production WIP orders\n\nExample: *"Which items are critically low today?"*`;
}

// ── Suggested quick prompts ───────────────────────────────────────────────────
const SUGGESTIONS = [
  "What's critically low?",
  "Top moving products",
  "Items expiring soon",
  "Show WIP orders",
  "Storage usage",
];

// ── Component ─────────────────────────────────────────────────────────────────
const IMSChatBot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      text: "👋 Hi! I'm your **IMS AI Assistant**. Ask me anything about your inventory — stock levels, alerts, forecasts, or production orders.",
      isBot: true,
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const sendMessage = (text) => {
    const userText = text || input.trim();
    if (!userText) return;
    setInput('');
    setMessages(prev => [...prev, { text: userText, isBot: false }]);
    setIsTyping(true);

    // Simulate thinking delay
    setTimeout(() => {
      const reply = generateResponse(userText);
      setMessages(prev => [...prev, { text: reply, isBot: true }]);
      setIsTyping(false);
    }, 600 + Math.random() * 400);
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
          <div className="ims-chatbot-suggestions">
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
