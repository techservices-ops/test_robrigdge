# 🚀 Barcode Generator Setup Guide

## 📋 Prerequisites

### **Required Software:**
- **Node.js** (v16 or higher) - [Download here](https://nodejs.org/)
- **Python** (v3.8 or higher) - [Download here](https://python.org/)
- **Git** - [Download here](https://git-scm.com/)

### **Verify Installation:**
```bash
node --version
npm --version
python --version
git --version
```

## 🎯 Quick Start (One Command Setup)

### **Option 1: Automated Setup (Recommended)**
```bash
# Clone the repository
git clone https://github.com/HARIHARANMURALIREC/Robridge-Software.git
cd Robridge-Software

# Run the automated setup
cd "Robridge web"
npm run setup
```

### **Option 2: Manual Setup**
```bash
# 1. Install Node.js dependencies
cd "Robridge web"
npm install

# 2. Install Python dependencies
cd "../Barcode generator&Scanner"
pip install -r requirements.txt

# 3. Start the system
cd "../Robridge web"
npm run dev
```

## 🌐 Access Your Barcode Generator

After setup, open your browser:
- **React Web App**: http://localhost:3002
- **Express Server**: http://localhost:3001
- **Python Backend**: http://localhost:5000

## 🔧 Troubleshooting

### **Port Already in Use:**
```bash
# Kill processes using ports 3001, 3002, 5000
netstat -ano | findstr :3001
netstat -ano | findstr :3002
netstat -ano | findstr :5000
```

### **Python Not Found:**
```bash
# Add Python to PATH or use full path
python --version
# or
py --version
```

### **Dependencies Issues:**
```bash
# Clear npm cache
npm cache clean --force

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

## 📱 Features

✅ **Auto-start Python backend** when needed  
✅ **Real-time barcode generation** (QR, Code128, EAN13)  
✅ **Database storage** with SQLite  
✅ **Responsive web interface**  
✅ **Download options** (PNG, PDF)  

## 🆘 Need Help?

If you encounter issues:
1. Check the console for error messages
2. Verify all prerequisites are installed
3. Check if ports are available
4. Review the troubleshooting section above

## 🎉 Success!

Once everything is running, you should see:
- React app with barcode generation form
- "Backend running" status indicator
- Ability to generate and download barcodes
- All data automatically saved to database
