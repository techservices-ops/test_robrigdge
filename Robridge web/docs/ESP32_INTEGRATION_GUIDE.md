# 🔌 ESP32 WiFi Integration Guide

## 📋 Overview

This guide explains how to connect your ESP32 barcode scanner to the Robridge Web application for real-time barcode scanning over WiFi.

## 🏗️ Architecture

```
ESP32 Scanner → WiFi → Express Server → WebSocket → React Barcode Scanner Tab
     ↓              ↓                    ↓              ↓
Barcode Data → HTTP POST → Real-time Updates → UI Display
```

## 🛠️ Setup Instructions

### 1. **ESP32 Code Setup**

1. **Open Arduino IDE** and install ESP32 board support
2. **Install required libraries**:
   ```
   - WiFi (built-in)
   - HTTPClient (built-in)
   - ArduinoJson (install from Library Manager)
   ```
3. **Update the ESP32 code** (`ESP32_WiFi_Transmitter.ino`):
   - Change `YOUR_WIFI_SSID` to your WiFi network name
   - Change `YOUR_WIFI_PASSWORD` to your WiFi password
   - Update `serverIP` to your computer's IP address

### 2. **Network Configuration**

**Find your computer's IP address:**
- **Windows**: Run `ipconfig` in Command Prompt
- **Mac/Linux**: Run `ifconfig` in Terminal
- Look for IPv4 address (e.g., `192.168.1.100`)

**Update ESP32 code with your IP:**
```cpp
const char* serverIP = "192.168.1.100"; // Your computer's IP
```

### 3. **Hardware Connections**

Connect your ESP32 to the barcode scanner:

```
ESP32 Pin    →    Barcode Scanner
Pin 2        →    Scan Trigger (if available)
Pin 4        →    Barcode Data Output
Pin 5        →    Status LED
GND          →    Ground
3.3V/5V      →    Power (check scanner requirements)
```

### 4. **Server Setup**

1. **Install dependencies**:
   ```bash
   cd "Robridge web"
   npm install socket.io
   ```

2. **Start the server**:
   ```bash
   npm run server
   ```

3. **Verify server is running**:
   - Open browser to `http://localhost:3001/api/health`
   - Should return: `{"status":"ok","timestamp":"..."}`

### 5. **Testing the Integration**

1. **Upload ESP32 code** and open Serial Monitor
2. **Power on ESP32** - should connect to WiFi and register with server
3. **Open Robridge Web** at `http://localhost:3001`
4. **Go to Barcode Scanner tab**
5. **Switch to ESP32 mode** using the mode selector
6. **Trigger a barcode scan** on ESP32
7. **Check web interface** - scan should appear in real-time

## 📡 **API Endpoints**

The server provides these endpoints for ESP32 communication:

### Device Registration
```
POST /api/esp32/register
{
  "deviceId": "ESP32_SCANNER_001",
  "deviceName": "ESP32-Barcode-Scanner",
  "ipAddress": "192.168.1.150",
  "firmwareVersion": "1.0.0"
}
```

### Heartbeat/Ping
```
POST /api/esp32/ping/{deviceId}
```

### Send Barcode Scan
```
POST /api/esp32/scan/{deviceId}
{
  "barcodeData": "QR123456789",
  "scanType": "QR_CODE",
  "timestamp": "2024-01-15T10:30:00Z",
  "imageData": "base64_encoded_image" // optional
}
```

### Get Connected Devices
```
GET /api/esp32/devices
```

## 🔧 **Customization**

### **Modify Barcode Reading Function**

Replace the `readBarcodeFromScanner()` function with your actual implementation:

```cpp
String readBarcodeFromScanner() {
  // Your barcode reading code here
  // Return the scanned barcode as String
  
  // Example for UART-based scanner:
  if (Serial2.available()) {
    String barcode = Serial2.readStringUntil('\n');
    barcode.trim();
    return barcode;
  }
  
  // Example for I2C-based scanner:
  // Read from I2C scanner module
  
  // Example for camera-based scanner:
  // Process camera image and extract barcode
  
  return ""; // Return empty string if no barcode found
}
```

### **Add Image Capture**

If your ESP32 has a camera module, you can send image data:

```cpp
void sendBarcodeScan(String barcodeData, String imageData = "") {
  // ... existing code ...
  
  if (imageData.length() > 0) {
    doc["imageData"] = imageData; // Base64 encoded image
  }
  
  // ... rest of function ...
}
```

### **Multiple ESP32 Devices**

Each ESP32 should have a unique `deviceId`:

```cpp
// ESP32 #1
const String deviceId = "ESP32_SCANNER_001";

// ESP32 #2  
const String deviceId = "ESP32_SCANNER_002";

// ESP32 #3
const String deviceId = "ESP32_SCANNER_003";
```

## 🚨 **Troubleshooting**

### **ESP32 Won't Connect to WiFi**
- Check SSID and password
- Ensure WiFi network is 2.4GHz (ESP32 doesn't support 5GHz)
- Check signal strength

### **ESP32 Can't Reach Server**
- Verify server IP address
- Check if server is running on port 3001
- Ensure ESP32 and computer are on same network
- Check firewall settings

### **No Data in Web Interface**
- Open browser developer tools (F12)
- Check Console tab for WebSocket errors
- Verify ESP32 is registered (check server logs)
- Test API endpoints directly

### **WebSocket Connection Issues**
- Ensure server is running with `npm run server`
- Check if port 3001 is accessible
- Try refreshing the web page
- Check browser console for errors

## 📊 **Monitoring**

### **ESP32 Serial Monitor**
Monitor ESP32 activity:
```
Connecting to WiFi........
WiFi connected successfully!
IP address: 192.168.1.150
Registering device with server...
Device registered successfully!
Barcode scanned: QR123456789
Sending barcode scan to server...
Barcode scan sent successfully!
```

### **Server Logs**
Monitor server activity:
```
ESP32 device registered: ESP32-Barcode-Scanner (ESP32_SCANNER_001)
ESP32 barcode scan received from ESP32-Barcode-Scanner: QR123456789
Client connected to WebSocket: abc123
```

### **Web Interface**
- Real-time device status
- Live barcode scan results
- Connection indicators
- Device statistics

## 🔮 **Advanced Features**

### **Barcode History**
Store scan history in database for reporting and analytics.

### **Device Management**
Add device configuration, remote updates, and diagnostics.

### **Security**
Implement authentication, encryption, and access control.

### **Multiple Networks**
Support for different WiFi networks and roaming.

## 🎯 **Production Deployment**

### **Static IP Assignment**
Assign static IP to ESP32 for reliable connection.

### **SSL/TLS Encryption**
Use HTTPS for secure communication.

### **Database Integration**
Store all scans in database for analytics.

### **User Authentication**
Add login system for web interface access.

---

## 🆘 **Support**

If you encounter issues:
1. Check the troubleshooting section above
2. Verify all connections and configurations
3. Test each component individually
4. Check server and ESP32 logs
5. Ensure all dependencies are installed

**Happy Scanning!** 🎉
