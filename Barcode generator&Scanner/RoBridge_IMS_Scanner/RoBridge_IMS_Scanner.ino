
/*
 * ESP32 GM77 Barcode Scanner with Robridge Integration - OPTIMIZED
 *
 * This code combines:
 * - GM77 barcode scanner functionality
 * - OLED display with status information
 * - Gemini AI analysis
 * - Robridge web application integration
 *
 * Hardware Requirements:
 * - ESP32 board
 * - GM77 barcode scanner (UART2: GPIO16 RX, GPIO17 TX)
 * - SH1106 OLED display (I2C: 0x3C)
 * - WiFi connection
 *
 * Setup:
 * 1. Update WiFi credentials below
 * 2. Update server IP address to your computer's IP
 * 3. Upload this code to ESP32
 */

// ===== PRODUCTION MODE CONFIGURATION =====
#define PRODUCTION_MODE false // Set to false for development/debugging
// ==========================================

#include "MAX1704X.h" // MAX1704X Fuel Gauge Library
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h> // Use SH1106/SH1107 driver
#include <ArduinoJson.h>
#include <ESPmDNS.h> // Support standard network naming
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <Preferences.h> // For storing server config
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h> // <- ADD THIS LINE
#include <Wire.h>

// ===== [BLE HID] Includes =====
#include "esp_gap_ble_api.h"
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEHIDDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <HIDTypes.h>
// ===== [/BLE HID] =====

// ===== [BLE HID] Globals, Report Map, Callbacks =====
BLEHIDDevice *hid;
BLECharacteristic *input;
bool bleConnected = false;

const uint8_t reportMap[] = {
    0x05, 0x01, 0x09, 0x06, 0xa1, 0x01, 0x85, 0x01, 0x05, 0x07, 0x19,
    0xe0, 0x29, 0xe7, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08,
    0x81, 0x02, 0x95, 0x01, 0x75, 0x08, 0x81, 0x01, 0x95, 0x05, 0x75,
    0x01, 0x05, 0x08, 0x19, 0x01, 0x29, 0x05, 0x91, 0x02, 0x95, 0x01,
    0x75, 0x03, 0x91, 0x01, 0x95, 0x06, 0x75, 0x08, 0x15, 0x00, 0x25,
    0x65, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65, 0x81, 0x00, 0xc0};

class MyCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *pServer) {
    bleConnected = true;
    Serial.println("[BLE] Host connected!");
  }
  void onDisconnect(BLEServer *pServer) {
    bleConnected = false;
    Serial.println("[BLE] Host disconnected — restarting advertising...");
    delay(1000);
    BLEDevice::startAdvertising();
  }
};
// ===== [/BLE HID] Globals =====

// ---------------------------------------------------------------
// Function Prototypes (Fixes Scope Issues)
// ---------------------------------------------------------------
void debugPrint(String message, bool newline = true);
void handleSystemFactoryReset();
void handleWiFiReconfiguration();
void displayStatusScreen();
void displayStatusBar();
void updateBattery();
void displayBatteryStatus(Adafruit_SH1106G &display, int x, int y);
void displayManualConnect();
void enterLightSleep();
void wakeDisplay();
void registerWithRobridge();
void checkWiFiConnection();
void loadServerConfig();
void saveServerConfig();
void updateServerURLs();
void loadLockState();
void saveLockState();
void loadPairingData();
void savePairingData();
void displayLockedScreen();
void unlockSystem();
int showModeSelectionScreen(); // Changed to return int (1, 2, 3)
void setupWiFiViaQR();         // New function
void saveBluetoothMode(bool bluetooth);
void checkTriggerRestart();
String cleanBarcode(String rawData);
void sendBasicScanToRobridge(String barcodeData);
void displayBasicScanInfo(String barcodeData);
void displayAIAnalysisWithScroll(String title, String category,
                                 String description);
String getCurrentTimestamp();
// ===== [BLE HID] Function Prototypes =====
void sendKey(uint8_t modifier, uint8_t keycode);
void sendStringOverBLE(String data);
// ===== [/BLE HID] =====

// ---------------------------------------------------------------
// Light Sleep Integration Configuration
// ---------------------------------------------------------------
#define SLEEP_TIMEOUT 180000 // Enter light sleep after 3 minutes of inactivity

// ---------------------------------------------------------------
// GM77 Trigger Pin Configuration
// ---------------------------------------------------------------
#define GM77_TRIG_PIN 35 // GM77 trigger button pin for wake-on-trigger

unsigned long lastActivityTime = 0;
unsigned long sleepStartTime = 0;
bool displayOn = true;

String wifiType = "";
String wifiSSID = "";
String wifiPassword = "";
bool wifiHidden = false;

const char *ssid = wifiSSID.c_str();
const char *password = wifiPassword.c_str();

Preferences wifiPrefs; // NEW: For storing WiFi QR credentials (moved for scope)

// --- OLED Setup ---
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
Adafruit_SH1106G display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1); // for SH1106

// --- GM77 Barcode Scanner on Serial2 ---
HardwareSerial GM77(2); // UART2 on ESP32 (GPIO16 RX, GPIO17 TX)

bool parseWifiQR(String qr) {
  // ===== ISSUE #6: QR VALIDATION WITH SAFE BOUNDS CHECKING =====
  wifiType = "";
  wifiSSID = "";
  wifiPassword = "";
  wifiHidden = false;

  qr.trim();

  // Validate: must start with "WIFI:"
  if (qr.length() < 6 || !qr.startsWith("WIFI:")) {
    Serial.println("[QR Parse] Invalid: does not start with WIFI:");
    return false;
  }

  // Strip "WIFI:" prefix
  qr = qr.substring(5);

  // Strip trailing ";;" if present
  if (qr.endsWith(";;")) {
    qr = qr.substring(0, qr.length() - 2);
  }

  // Safe token-by-token parsing with bounds checking
  while (qr.length() > 0) {
    int sep = qr.indexOf(';');
    String pair;
    if (sep == -1) {
      pair = qr; // Last field without trailing ;
      qr = "";
    } else {
      pair = qr.substring(0, sep);
      // Safe substring: only if sep+1 is within bounds
      qr = (sep + 1 < (int)qr.length()) ? qr.substring(sep + 1) : "";
    }

    int colon = pair.indexOf(':');
    if (colon < 1)
      continue; // No colon or key is empty — skip

    String key = pair.substring(0, colon);
    // Safe value extraction
    String value =
        (colon + 1 < (int)pair.length()) ? pair.substring(colon + 1) : "";

    if (key == "T")
      wifiType = value;
    else if (key == "S")
      wifiSSID = value;
    else if (key == "P")
      wifiPassword = value;
    else if (key == "H")
      wifiHidden = (value == "true");
  }

  // Validate: SSID must not be empty
  if (wifiSSID.length() == 0) {
    Serial.println("[QR Parse] Invalid: SSID is empty");
    return false;
  }

  Serial.println("[QR Parse] SSID: " + wifiSSID);

  // Save credentials persistently
  wifiPrefs.begin("wifi_creds", false);
  wifiPrefs.putString("ssid", wifiSSID);
  wifiPrefs.putString("password", wifiPassword);
  wifiPrefs.end();

  // Show visual confirmation
  display.clearDisplay();
  displayStatusBar();
  display.setCursor(0, 20);
  display.println("WiFi Credentials");
  display.println("Saved!");
  display.println(wifiSSID.substring(0, 16)); // Safe truncate for display
  display.display();

  // Non-blocking 1.5s display hold
  unsigned long showStart = millis();
  while (millis() - showStart < 1500) {
    delay(10);
  }

  // Prepare WiFi (setupWiFiViaQR calls connectWiFi after this, no WiFi.begin
  // here)
  return true;
}

// --- WiFi Configuration ---

// --- Robridge Server Configuration ---
// String expressServerURL = "http://10.204.193.1:3001";  // Express backend -
// LOCAL String aiServerURL = "http://10.204.193.1:8000";  // AI server - LOCAL
// UPDATE THESE TO YOUR LOCAL IP ADDRESS
String expressServerURL = "https://test-robrigdge.onrender.com"; // Express backend
String aiServerURL = "http://10.168.108.1:8000"; // AI server
String customServerIP = "";                  // Custom server IP from portal

// --- ESP32 Device Configuration ---
const String deviceId = "BVS_Scanner_42";
const String deviceName = "BVS Scanner  42"; // ✅ AI ENABLED - Contains "AI"
const String deviceNameid = "BVS-Scanner-42";
const String pwd = "rob123456";
const String firmwareVersion = "2.0.0";

// --- Gemini API Configuration ---
const char *gemini_api_key = "AIzaSyASPgBz59it8cF3biu1q75RtuDesEeJc1M";
const char *gemini_api_url = "https://generativelanguage.googleapis.com/v1beta/"
                             "models/gemini-pro:generateContent";

// --- GM77 Barcode Scanner on Serial2 (declared above for scope) ---
// HardwareSerial GM77(2); // moved above parseWifiQR

// --- Product Structure ---
struct Product {
  String barcode;
  String name;
  String type;
  String details;
  String price;
  String category;
  String location;
};

// Robridge Logo bitmap data (Working Version)
static const unsigned char PROGMEM epd_bitmap_ro_bridge[] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x70, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x0f, 0xe0, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x00,
    0x78, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0xf8, 0x00, 0x00,
    0xff, 0xf8, 0x00, 0x00, 0x78, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0f, 0xfc, 0x00, 0x00, 0xff, 0x3c, 0x00, 0x00, 0x78, 0x00, 0x0e, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x0f, 0xbe, 0x00, 0x00, 0xff, 0x3e, 0x00, 0x00,
    0x78, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0xbe, 0x00, 0x00,
    0xfe, 0x1e, 0x00, 0x00, 0x30, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0f, 0x9f, 0x00, 0x00, 0xfe, 0x1e, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x0f, 0x9f, 0x00, 0x00, 0x06, 0x3f, 0x00, 0x00,
    0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x1f, 0x00, 0x00,
    0x06, 0x3f, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0f, 0x1f, 0x80, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x0e, 0x0f, 0x80, 0x00, 0xfc, 0xff, 0x00, 0x00,
    0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x0f, 0x80, 0x00,
    0xfd, 0xff, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0e, 0x0f, 0x80, 0xf0, 0x01, 0xff, 0x06, 0x00, 0x70, 0x07, 0x0e, 0x00,
    0x60, 0x00, 0x1c, 0x00, 0x0e, 0x07, 0x83, 0xfc, 0x03, 0xff, 0x07, 0x3c,
    0x70, 0x1f, 0xce, 0x01, 0xf9, 0xc0, 0x7f, 0x00, 0x0e, 0x0f, 0x83, 0xfc,
    0x7f, 0xff, 0x07, 0x7c, 0x70, 0x1f, 0xce, 0x03, 0xf9, 0xc0, 0x7f, 0x80,
    0x0e, 0x8f, 0x87, 0xfe, 0x7f, 0xff, 0x07, 0x78, 0x70, 0x3f, 0xee, 0x07,
    0xfd, 0xc0, 0xff, 0xc0, 0x0f, 0x2f, 0x8f, 0xff, 0x7f, 0xff, 0x07, 0xf8,
    0x70, 0x3c, 0xfe, 0x07, 0x9d, 0xc1, 0xe3, 0xc0, 0x0f, 0xff, 0x0f, 0x0f,
    0x3f, 0x9f, 0x07, 0xf8, 0x70, 0x78, 0x3e, 0x0f, 0x07, 0xc1, 0xc1, 0xe0,
    0x0e, 0x0f, 0x1e, 0x07, 0x3f, 0x8e, 0x07, 0xc0, 0x70, 0x70, 0x1e, 0x0e,
    0x07, 0xc3, 0x80, 0xe0, 0x0e, 0x0f, 0x1e, 0x07, 0xbf, 0x8e, 0x07, 0xc0,
    0x70, 0x70, 0x1e, 0x1e, 0x03, 0xc3, 0x80, 0xe0, 0x0f, 0x0f, 0x1c, 0x03,
    0x9f, 0x04, 0x07, 0x80, 0x70, 0xe0, 0x1e, 0x1c, 0x03, 0xc3, 0x80, 0x60,
    0x0f, 0x1e, 0x1c, 0x03, 0x80, 0x06, 0x07, 0x00, 0x70, 0xe0, 0x0e, 0x1c,
    0x01, 0xc3, 0x00, 0x70, 0x0f, 0x1e, 0x3c, 0x03, 0x9f, 0x0f, 0x07, 0x00,
    0x70, 0xe0, 0x0e, 0x1c, 0x01, 0xc7, 0x00, 0x70, 0x0f, 0xfc, 0x38, 0x01,
    0xdf, 0x8f, 0x07, 0x00, 0x70, 0xe0, 0x0e, 0x18, 0x01, 0xc7, 0x00, 0x70,
    0x0f, 0x1c, 0x38, 0x01, 0xdf, 0x8f, 0x07, 0x00, 0x70, 0xe0, 0x0e, 0x18,
    0x01, 0xc7, 0x00, 0x70, 0x0f, 0x9c, 0x38, 0x01, 0xdf, 0xff, 0x87, 0x00,
    0x70, 0xe0, 0x0e, 0x18, 0x01, 0xc7, 0xff, 0xf0, 0x0f, 0x9c, 0x38, 0x01,
    0xdf, 0xff, 0x87, 0x00, 0x70, 0xe0, 0x0e, 0x18, 0x01, 0xc7, 0xff, 0xf0,
    0x0f, 0x9c, 0x38, 0x01, 0xdf, 0xff, 0x87, 0x00, 0x70, 0xe0, 0x0e, 0x18,
    0x01, 0xc7, 0xff, 0xf0, 0x0f, 0x9c, 0x38, 0x01, 0xdf, 0xff, 0x87, 0x00,
    0x70, 0xe0, 0x0e, 0x18, 0x01, 0xc7, 0x00, 0x00, 0x0f, 0x9e, 0x38, 0x01,
    0x83, 0xff, 0x87, 0x00, 0x70, 0xe0, 0x0e, 0x1c, 0x01, 0xc7, 0x00, 0x00,
    0x0f, 0x9e, 0x3c, 0x03, 0x81, 0xff, 0x87, 0x00, 0x70, 0xe0, 0x0e, 0x1c,
    0x01, 0xc7, 0x00, 0x00, 0x0f, 0x9e, 0x1c, 0x03, 0x9c, 0xff, 0x87, 0x00,
    0x70, 0xe0, 0x0e, 0x1c, 0x01, 0xc3, 0x00, 0x00, 0x0f, 0x9e, 0x1c, 0x03,
    0x9e, 0xff, 0x87, 0x00, 0x70, 0xe0, 0x1e, 0x1c, 0x03, 0xc3, 0x80, 0x60,
    0x0f, 0xbe, 0x1e, 0x07, 0xbe, 0x3f, 0x87, 0x00, 0x70, 0x70, 0x1e, 0x0e,
    0x03, 0xc3, 0x80, 0xe0, 0x0f, 0xbf, 0x1e, 0x07, 0x26, 0x3f, 0x07, 0x00,
    0x70, 0x70, 0x1e, 0x0e, 0x07, 0xc3, 0xc0, 0xe0, 0x0f, 0x9f, 0x0f, 0x0f,
    0x06, 0x1f, 0x07, 0x00, 0x70, 0x78, 0x3e, 0x0f, 0x07, 0xc1, 0xc1, 0xe0,
    0x0f, 0x9f, 0x0f, 0xff, 0x06, 0x1f, 0x07, 0x00, 0x70, 0x3c, 0x6e, 0x07,
    0x9d, 0xc1, 0xf7, 0xc0, 0x0f, 0x9f, 0x07, 0xfe, 0x06, 0x3e, 0x07, 0x00,
    0x70, 0x3f, 0xee, 0x07, 0xfd, 0xc0, 0xff, 0x80, 0x0f, 0x9f, 0x83, 0xfc,
    0xc7, 0x3e, 0x07, 0x00, 0x70, 0x1f, 0xce, 0x03, 0xf9, 0xc0, 0xff, 0x80,
    0x0f, 0x9f, 0x83, 0xf8, 0xe7, 0xfc, 0x07, 0x00, 0x70, 0x0f, 0xce, 0x01,
    0xf1, 0xc0, 0x3f, 0x00, 0x00, 0x00, 0x00, 0xf0, 0xef, 0xe0, 0x06, 0x00,
    0x00, 0x07, 0x00, 0x00, 0x41, 0xc0, 0x1c, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0xc0, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x03, 0x80, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0e,
    0x03, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x0e, 0x07, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x0f, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07,
    0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x07, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xfc, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    0xfc, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00};

// --- Status Variables ---
bool wifiConnected = false;
bool robridgeConnected = false;
String lastScannedCode = "";
unsigned long lastScanTime =
    0; // Timestamp of last scan for duplicate prevention
String lastApiResponse = "";
unsigned long lastPingTime = 0;
unsigned long pingInterval = 30000; // Ping every 30 seconds
bool isRegistered = false;
unsigned long scanCount = 0;
String deviceIP = "";        // Device IP address
String userToken = "";       // User authentication token from QR code
bool isPaired = false;       // Device paired with user account
bool fuelGaugeFound = false; // Track if MAX1704X is responsive
int batteryFailureCount = 0; // Track consecutive failed readings

Preferences batteryPrefs;          // NEW: For storing battery state
unsigned long lastBatterySave = 0; // NEW: Track last save time

// --- Preferences for storing server config ---
Preferences preferences;

// Battery state validation
bool batteryStateValid = false;
unsigned long batteryInitTime = 0;

// --- System Lock Configuration ---
const String INIT_BARCODE =
    "BVS-110-INI"; // Initialization barcode from quick start guide
bool systemLocked =
    true; // System starts LOCKED by default - requires initialization barcode
bool firstBoot = true; // True on first boot, false after first unlock

// --- Non-Blocking Scanner & Display State ---
String scannerBuffer = "";
bool scanReady = false;
unsigned long scanLastCharTime = 0; // For timeout-based flushing

enum DisplayState { DISPLAY_IDLE, DISPLAY_SHOWING_RESULT };
DisplayState currentDisplayState = DISPLAY_IDLE;
unsigned long displayTimerStart = 0;
unsigned long displayDuration = 0;

// --- Bluetooth Mode Configuration ---
bool bluetoothMode = false; // True = skip WiFi, work Bluetooth

// --- Display State Management ---
bool isManualConnectMode = false; // Tracks if we are in manual connect screen
bool blockDisplayUpdates =
    true; // START BLOCKED - suppress warnings during startup sequences
bool silentWiFiMode = false; // True during initial boot sequence

// ===== SYSTEM STATE MACHINE =====
enum SystemState {
  BOOT,
  READY_TO_SCAN,
  QR_SCAN_MODE,
  MANUAL_CONNECT_MODE,
  CONNECTING_WIFI,
  WIFI_CONNECTED,
  WIFI_DISCONNECTED
};
SystemState systemState = BOOT;

// ===== NON-BLOCKING AUTO-RECONNECT =====
unsigned long lastReconnectAttempt = 0;
const unsigned long RECONNECT_INTERVAL = 5000; // 5 seconds between attempts
bool reconnectEnabled = false; // Only active after initial setup

// ... (existing MAX1704X fuelGauge declaration remains below) ...

// --- WiFi Event Handler (Event-driven, instant state update) ---
void onWiFiEvent(WiFiEvent_t event) {
  switch (event) {
  case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
    Serial.println("[WiFi Event] Disconnected!");
    wifiConnected = false;
    robridgeConnected = false;
    // Instantly update system state so display reflects poor network
    // immediately
    if (systemState == READY_TO_SCAN || systemState == WIFI_CONNECTED) {
      systemState = WIFI_DISCONNECTED;
    }
    // Enable auto-reconnect after disconnection
    if (!bluetoothMode) {
      reconnectEnabled = true;
      lastReconnectAttempt = millis(); // Start timer now
    }
    break;

  case ARDUINO_EVENT_WIFI_STA_GOT_IP:
    Serial.print("[WiFi Event] Got IP: ");
    Serial.println(WiFi.localIP());
    wifiConnected = true;
    deviceIP = WiFi.localIP().toString();
    reconnectEnabled = false; // Stop reconnect attempts

    // Start mDNS broadcasting
    if (MDNS.begin(deviceNameid.c_str())) {
      debugPrint("mDNS responder started: " + deviceNameid + ".local");
    }

    // Transition back to READY_TO_SCAN on reconnect
    if (systemState == WIFI_DISCONNECTED || systemState == CONNECTING_WIFI) {
      systemState = READY_TO_SCAN;
      if (!blockDisplayUpdates)
        displayStatusScreen();
    }
    break;
  }
}

// MAX1704X Fuel Gauge Configuration (fine-tuned calibration)
// Calibration: 1.277 × (3.89V actual / 3.99V measured) = 1.245
MAX1704X fuelGauge = MAX1704X(1.245); // Calibrated ADC resolution
unsigned long lastBatteryUpdate = 0;
const unsigned long batteryUpdateInterval =
    1000; // Update every 1 second for real-time response
float voltage = 0.0;
float bat_percentage = 0.0;

// ===== CHARGING DETECTION (Single CHRG Pin Only) =====
// CHRG pin: LOW = Charging, HIGH = Not charging (fully charged or disconnected)
#define CHARGING_PIN 27 // CHRG pin from charger module (active LOW)
bool isCharging = false;
bool isFullyCharged = false;

// ===== CHARGING ANIMATION STATE TRACKING =====
bool wasCharging = false;
unsigned long chargingStartTime = 0;
bool showFullScreenCharging = false;

// ===== BATTERY WARNING STATE TRACKING =====
bool isBatteryWarningActive = false;
unsigned long batteryWarningEndTime = 0;
String batteryWarningType = ""; // "CRITICAL" or "LOW"

// ===== WIFI RECONNECT STATE TRACKING =====
unsigned long wifiConnectStartTime = 0;
bool wifiAttemptingConnect = false;

// MAX1704X Battery Monitoring - Real-time with custom voltage mapping
void updateBattery() {
  // Low battery warning state tracking
  static bool warning15Shown = false;
  static bool warning5Shown = false;
  static unsigned long lastWarningTime = 0;

  // Check battery update interval
  unsigned long currentTime = millis();
  if (currentTime - lastBatteryUpdate < batteryUpdateInterval) {
    return;
  }
  lastBatteryUpdate = currentTime;

  // ===== READ VOLTAGE AND CHARGING STATUS WITH FILTERING =====
  float newVoltage = fuelGauge.voltage();
  bool rawChrgPin = digitalRead(CHARGING_PIN);
  bool rawIsCharging = !rawChrgPin;

  // Software Debouncing / Filtering for Charging Pin
  // Requires steady signal to filter out noise
  static int chargingConfirmCounter = 0;
  static int dischargingConfirmCounter = 0;

  if (rawIsCharging) {
    chargingConfirmCounter++;
    dischargingConfirmCounter = 0;
  } else {
    dischargingConfirmCounter++;
    chargingConfirmCounter = 0;
  }

  bool newIsCharging = isCharging; // Maintain previous state by default
  if (chargingConfirmCounter >= 2) {
    newIsCharging = true;
  } else if (dischargingConfirmCounter >= 2) {
    newIsCharging = false;
  }

  // ===== FIX: REMOVED FALSE FAILURE DETECTION AT LOW VOLTAGE =====
  // Only trigger failure logic if voltage is effectively 0 (disconnected/error)
  if (newVoltage < 100.0) { // Changed from 3500.0 to 100.0
    batteryFailureCount++;
    if (batteryFailureCount % 10 == 0) {
      Serial.printf("⚠️ Battery reading failure (%d). Voltage: %.0fmV\n",
                    batteryFailureCount, newVoltage);
    }

    if (batteryFailureCount >= 20) {
      Serial.println("🔄 Force Re-initializing MAX1704X sensor...");
      fuelGauge.begin(DEFER_ADDRESS);
      uint8_t addr = fuelGauge.findFirstDevice();
      if (addr != 0) {
        fuelGauge.address(addr);
        fuelGauge.reset();
        delay(100);
        fuelGauge.quickstart();
        batteryFailureCount = 0;
        fuelGaugeFound = true;
      }
    }

    // Don't reset to 0% immediately on single failure, wait for count
    return;
  } else {
    batteryFailureCount = 0;
    fuelGaugeFound = true;
    voltage = newVoltage;
  }

  float voltageV = voltage / 1000.0;

  // ===== CRITICAL FIX #3: NEW MULTI-RANGE VOLTAGE MAPPING =====
  // This replaces your old linear 3.3V-4.1V mapping
  float newPercentage;

  if (voltageV >= 4.15) {
    // Definitely full
    newPercentage = 100.0;
  } else if (voltageV >= 4.05) {
    // Very high voltage - 95-100% range (CRITICAL for full battery restart)
    newPercentage = 95.0 + ((voltageV - 4.05) / (4.15 - 4.05)) * 5.0;
  } else if (voltageV >= 3.9) {
    // High voltage - 70-95% range
    newPercentage = 70.0 + ((voltageV - 3.9) / (4.05 - 3.9)) * 25.0;
  } else if (voltageV >= 3.7) {
    // Medium voltage - 30-70% range
    newPercentage = 30.0 + ((voltageV - 3.7) / (3.9 - 3.7)) * 40.0;
  } else if (voltageV >= 3.5) {
    // Low voltage - 10-30% range
    newPercentage = 10.0 + ((voltageV - 3.5) / (3.7 - 3.5)) * 20.0;
  } else if (voltageV >= 3.3) {
    // Very low voltage - 0-10% range
    newPercentage = ((voltageV - 3.3) / (3.5 - 3.3)) * 10.0;
  } else {
    // Below minimum
    newPercentage = 0.0;
  }

  // Clamp
  if (newPercentage > 100.0)
    newPercentage = 100.0;
  if (newPercentage < 0.0)
    newPercentage = 0.0;

  // ===== ISSUE #5: MOVING AVERAGE SMOOTHING (5-sample window) =====
  const int SMOOTH_SAMPLES = 5;
  static float battSamples[5] = {newPercentage, newPercentage, newPercentage,
                                 newPercentage, newPercentage};
  static int battSampleIdx = 0;
  battSamples[battSampleIdx] = newPercentage;
  battSampleIdx = (battSampleIdx + 1) % SMOOTH_SAMPLES;
  float battSum = 0;
  for (int i = 0; i < SMOOTH_SAMPLES; i++)
    battSum += battSamples[i];
  bat_percentage = battSum / SMOOTH_SAMPLES;

  // ===== CRITICAL FIX #4: SAVE BATTERY STATE PERIODICALLY =====
  // This saves the state every 30 seconds so it can be restored on restart
  if (currentTime - lastBatterySave > 30000) {
    batteryPrefs.begin("battery", false);
    batteryPrefs.putFloat("voltage", voltage);
    batteryPrefs.putFloat("percentage", bat_percentage);
    batteryPrefs.putULong("timestamp", millis());
    batteryPrefs.end();
    lastBatterySave = currentTime;
    debugPrint("💾 Battery state saved: " + String(voltage) + "mV (" +
               String(bat_percentage, 1) + "%)");
  }

  // ===== REST OF YOUR EXISTING CODE (charging detection, etc.) =====
  bool chargingTransition = (newIsCharging && !wasCharging);
  bool stopChargingTransition = (!newIsCharging && wasCharging);

  isCharging = newIsCharging;
  bool newIsFullyCharged = (!newIsCharging && bat_percentage >= 98.0);
  bool fullStateChange = (newIsFullyCharged != isFullyCharged);

  isFullyCharged = newIsFullyCharged;
  wasCharging = newIsCharging;

  if (systemLocked)
    return;

  if (chargingTransition) {
    chargingStartTime = millis();
    showFullScreenCharging = true;
    Serial.println("Charging started! Animation active.");
  }

  if (showFullScreenCharging && (millis() - chargingStartTime > 3000)) {
    showFullScreenCharging = false;
    if (!blockDisplayUpdates)
      displayStatusScreen();
  }

  if ((stopChargingTransition || fullStateChange) && !blockDisplayUpdates) {
    displayStatusScreen();
  }

  // Low battery warnings
  if (blockDisplayUpdates) {
    if (bat_percentage > 15) {
      warning15Shown = false;
      warning5Shown = false;
    } else if (bat_percentage > 5) {
      warning5Shown = false;
    }
  } else if (!isCharging && !isFullyCharged) {
    if (bat_percentage <= 5.0 && !warning5Shown) {
      warning5Shown = true;
      warning15Shown = true;
      lastWarningTime = millis();

      isBatteryWarningActive = true;
      batteryWarningEndTime = millis() + 2000; // 2 seconds
      batteryWarningType = "CRITICAL";
      displayStatusScreen();
    } else if (bat_percentage <= 15.0 && !warning15Shown) {
      warning15Shown = true;
      lastWarningTime = millis();

      isBatteryWarningActive = true;
      batteryWarningEndTime = millis() + 2000; // 2 seconds
      batteryWarningType = "LOW";
      displayStatusScreen();
    }
  }

  // Auto-clear warning and return to normal screen after 2 seconds
  if (isBatteryWarningActive && millis() >= batteryWarningEndTime) {
    isBatteryWarningActive = false;
    batteryWarningType = "";
    if (!blockDisplayUpdates)
      displayStatusScreen();
  }

  if (bat_percentage > 15.0) {
    warning15Shown = false;
    warning5Shown = false;
  } else if (bat_percentage > 5.0) {
    warning5Shown = false;
  }

  static bool lastCharging = false;
  if (newIsCharging != lastCharging) {
    Serial.printf(
        "⚡ BATTERY - Voltage: %.2fV (%.1f%%) | %s\n", voltageV, bat_percentage,
        isCharging ? "CHARGING" : (isFullyCharged ? "FULL" : "DISCHARGING"));
    lastCharging = newIsCharging;
  }

  static bool batteryWasFull = false;
  if (isFullyCharged && !isCharging && bat_percentage >= 98.0 &&
      !batteryWasFull) {
    batteryWasFull = true;
    Serial.println("✅ Charging finished - battery fully charged (checkmark "
                   "shown in status bar)");
  }

  if (bat_percentage < 98.0 || isCharging) {
    batteryWasFull = false;
  }

  // ===== ANOMALY DETECTION AND AUTO-CORRECTION =====
  // If voltage is high but percentage is suspiciously low, recalculate
  if (voltageV >= 4.0 && bat_percentage < 85.0 && fuelGaugeFound) {
    static unsigned long lastAnomalyFix = 0;

    // Only fix once per minute to avoid spam
    if (millis() - lastAnomalyFix > 60000) {
      debugPrint("⚠️ ANOMALY DETECTED!");
      debugPrint("   Voltage: " + String(voltageV, 2) + "V");
      debugPrint("   Percentage: " + String(bat_percentage, 1) + "%");
      debugPrint("   This doesn't match - forcing recalculation");

      // Force recalculation using voltage
      if (voltageV >= 4.15) {
        bat_percentage = 100.0;
      } else if (voltageV >= 4.10) {
        bat_percentage = 98.0 + ((voltageV - 4.10) / (4.15 - 4.10)) * 2.0;
      } else if (voltageV >= 4.05) {
        bat_percentage = 95.0 + ((voltageV - 4.05) / (4.10 - 4.05)) * 3.0;
      } else if (voltageV >= 4.00) {
        bat_percentage = 90.0 + ((voltageV - 4.00) / (4.05 - 4.00)) * 5.0;
      }

      debugPrint("✅ Corrected to: " + String(bat_percentage, 1) + "%");

      // Save corrected state
      batteryPrefs.begin("battery", false);
      batteryPrefs.putFloat("voltage", voltage);
      batteryPrefs.putFloat("percentage", bat_percentage);
      batteryPrefs.putULong("timestamp", millis());
      batteryPrefs.end();

      lastAnomalyFix = millis();
    }
  }
}

// ===== STEP 4: ADD CONTINUOUS MONITORING FUNCTION =====
// Add this new function anywhere in your code (before loop()):

void monitorBatteryHealth() {
  static unsigned long lastHealthCheck = 0;

  // Check every 10 seconds
  if (millis() - lastHealthCheck < 10000)
    return;
  lastHealthCheck = millis();

  if (!fuelGaugeFound)
    return;

  float currentV = fuelGauge.voltage();

  // Log for debugging
  debugPrint("🔋 Health Check: " + String(currentV) +
             "mV = " + String(bat_percentage, 1) + "%");

  // Check for impossible states
  if (currentV > 4000.0 && bat_percentage < 50.0) {
    debugPrint("⚠️ IMPOSSIBLE STATE DETECTED - Forcing correction");

    // Load saved state or recalculate
    batteryPrefs.begin("battery", true);
    float savedPct = batteryPrefs.getFloat("percentage", 0.0);
    batteryPrefs.end();

    if (savedPct > 80.0) {
      bat_percentage = savedPct;
      debugPrint("✅ Restored from saved: " + String(bat_percentage, 1) + "%");
    } else {
      // Force recalculation
      float vVolts = currentV / 1000.0;
      if (vVolts >= 4.10)
        bat_percentage = 98.0;
      else if (vVolts >= 4.05)
        bat_percentage = 95.0;
      else if (vVolts >= 4.00)
        bat_percentage = 90.0;
      debugPrint("✅ Recalculated: " + String(bat_percentage, 1) + "%");
    }
  }
}

// ===== DIAGNOSTIC TOOL - ADD THIS FUNCTION =====
// Call this from Serial commands to diagnose the issue

void diagnoseBatteryIssue() {
  Serial.println("\n========================================");
  Serial.println("BATTERY DIAGNOSTIC REPORT");
  Serial.println("========================================");

  // Read current IC values
  float icVoltage = fuelGauge.voltage();

  Serial.println("\n--- CURRENT STATE ---");
  Serial.printf("IC Voltage: %.0f mV (%.3f V)\n", icVoltage,
                icVoltage / 1000.0);
  Serial.printf("Stored Voltage: %.0f mV\n", voltage);
  Serial.printf("Stored Percentage: %.1f%%\n", bat_percentage);
  Serial.printf("Charging: %s\n", isCharging ? "YES" : "NO");
  Serial.printf("Fully Charged: %s\n", isFullyCharged ? "YES" : "NO");

  // Read saved state
  batteryPrefs.begin("battery", true);
  float savedV = batteryPrefs.getFloat("voltage", 0.0);
  float savedP = batteryPrefs.getFloat("percentage", 0.0);
  unsigned long savedT = batteryPrefs.getULong("timestamp", 0);
  batteryPrefs.end();

  Serial.println("\n--- SAVED STATE (NVS) ---");
  Serial.printf("Saved Voltage: %.0f mV\n", savedV);
  Serial.printf("Saved Percentage: %.1f%%\n", savedP);
  Serial.printf("Saved Age: %lu ms\n", millis() - savedT);

  // Voltage-based calculation
  float vVolts = icVoltage / 1000.0;
  float calculatedPct;

  if (vVolts >= 4.15)
    calculatedPct = 100.0;
  else if (vVolts >= 4.10)
    calculatedPct = 98.0 + ((vVolts - 4.10) / 0.05) * 2.0;
  else if (vVolts >= 4.05)
    calculatedPct = 95.0 + ((vVolts - 4.05) / 0.05) * 3.0;
  else if (vVolts >= 4.00)
    calculatedPct = 90.0 + ((vVolts - 4.00) / 0.05) * 5.0;
  else if (vVolts >= 3.9)
    calculatedPct = 70.0 + ((vVolts - 3.9) / 0.1) * 20.0;
  else
    calculatedPct = 50.0; // Simplified for diagnostic

  Serial.println("\n--- CALCULATED VALUES ---");
  Serial.printf("Voltage-based percentage: %.1f%%\n", calculatedPct);
  Serial.printf("Difference from stored: %.1f%%\n",
                calculatedPct - bat_percentage);

  // Recommendations
  Serial.println("\n--- DIAGNOSIS ---");
  if (icVoltage > 4000.0 && bat_percentage < 50.0) {
    Serial.println("❌ CRITICAL: High voltage but low percentage!");
    Serial.println("   This indicates MAX1704X SOC register was reset");
    Serial.println("   RECOMMENDATION: Restart device to reload saved state");
  } else if (abs(icVoltage - savedV) < 100.0 &&
             abs(bat_percentage - savedP) > 10.0) {
    Serial.println("⚠️ WARNING: Voltage stable but percentage drifted");
    Serial.println("   RECOMMENDATION: Recalibrate using voltage mapping");
  } else {
    Serial.println("✅ Battery state appears normal");
  }

  Serial.println("========================================\n");
}

// ===== BATTERY DISPLAY - AUTO-SWITCHING (DISCHARGING vs CHARGING) =====

// Draw small battery icon with fill level (DISCHARGING MODE)
void drawBatteryIcon(Adafruit_SH1106G &display, int x, int y) {
  int width = 12;   // small icon width
  int height = 6;   // small icon height
  int capWidth = 2; // battery cap width

  // Calculate fill width - ensure 100% shows completely full
  int maxFillWidth =
      width - 2; // Maximum fill width (leave 1px border on each side)
  int fillWidth = (int)((bat_percentage / 100.0) * maxFillWidth);

  // Ensure at 100% it's completely full
  if (bat_percentage >= 99.5) {
    fillWidth = maxFillWidth;
  }

  display.drawRect(x, y, width, height, SH110X_WHITE); // outline
  display.fillRect(x + 1, y + 1, fillWidth, height - 2, SH110X_WHITE); // fill
  display.fillRect(x + width, y + 2, capWidth, height - 4, SH110X_WHITE); // cap
}

// Draw compact charging battery icon (CHARGING MODE - ANIMATED FILLING)
// Nokia-style continuous filling animation
void drawChargingBatteryIcon(Adafruit_SH1106G &display, int x, int y) {
  int width = 12;
  int height = 6;
  int capWidth = 2;

  // Animated filling effect - cycles from 0% to 100% continuously
  static unsigned long lastAnimUpdate = 0;
  static int animFillLevel = 0; // 0 to 100

  // Update animation every 200ms for smooth filling
  if (millis() - lastAnimUpdate > 200) {
    animFillLevel += 10; // Increase by 10% each step
    if (animFillLevel > 100) {
      animFillLevel = 0; // Reset to empty and start again
    }
    lastAnimUpdate = millis();
  }

  // Calculate fill width based on animation level
  int maxFillWidth = width - 2;
  int fillWidth = (int)((animFillLevel / 100.0) * maxFillWidth);

  // Draw battery outline
  display.drawRect(x, y, width, height, SH110X_WHITE);

  // Draw animated fill
  if (fillWidth > 0) {
    display.fillRect(x + 1, y + 1, fillWidth, height - 2, SH110X_WHITE);
  }

  // Draw battery cap
  display.fillRect(x + width, y + 2, capWidth, height - 4, SH110X_WHITE);

  // Draw mini lightning bolt (charging indicator) - 4x5 pixels
  int boltX = x + width + capWidth + 2;
  int boltY = y;
  display.fillTriangle(boltX, boltY, boltX + 2, boltY, boltX, boltY + 5,
                       SH110X_WHITE);
  display.fillTriangle(boltX, boltY + 5, boltX + 2, boltY + 5, boltX + 4, boltY,
                       SH110X_WHITE);
}

// Draw fully charged icon (checkmark instead of lightning)
void drawFullyChargedIcon(Adafruit_SH1106G &display, int x, int y) {
  int width = 12;
  int height = 6;
  int capWidth = 2;

  // Draw battery outline (fully filled)
  display.drawRect(x, y, width, height, SH110X_WHITE);
  display.fillRect(x + 1, y + 1, width - 3, height - 2, SH110X_WHITE);
  display.fillRect(x + width, y + 2, capWidth, height - 4, SH110X_WHITE);

  // Draw mini checkmark - 4x4 pixels
  int checkX = x + width + capWidth + 2;
  int checkY = y + 1;
  display.drawLine(checkX, checkY + 2, checkX + 1, checkY + 3, SH110X_WHITE);
  display.drawLine(checkX + 1, checkY + 3, checkX + 4, checkY, SH110X_WHITE);
  display.drawLine(checkX, checkY + 3, checkX + 1, checkY + 4, SH110X_WHITE);
  display.drawLine(checkX + 1, checkY + 4, checkX + 4, checkY + 1,
                   SH110X_WHITE);
}

// Smart battery display - auto-switches between modes
void displayBatteryStatus(Adafruit_SH1106G &display, int x, int y) {
  // Show checkmark ONLY when isFullyCharged flag is true
  // (battery at 100% AND not currently charging)
  if (isFullyCharged) {
    // Show fully charged icon (battery + checkmark)
    drawFullyChargedIcon(display, x, y);
  } else if (isCharging) {
    // Show charging icon (battery + lightning bolt)
    drawChargingBatteryIcon(display, x, y);
  } else {
    // Show normal discharging icon (battery only)
    drawBatteryIcon(display, x, y);
  }
}

// ===== FULL-SCREEN CHARGING ANIMATION FUNCTIONS =====

// Draw full-screen charging animation (shown for 3 seconds when charging
// starts)
void drawFullScreenCharging() {
  // Large "CHARGING" text
  display.setTextSize(2);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(10, 10);
  display.print("CHARGING");

  // Large battery icon
  int battX = 34;
  int battY = 35;
  int battWidth = 50;
  int battHeight = 20;

  display.drawRect(battX, battY, battWidth, battHeight, SH110X_WHITE);
  display.fillRect(battX + battWidth, battY + 6, 3, 8, SH110X_WHITE);

  // Animated fill based on time
  int frame = (millis() / 500) % 4;
  int segmentWidth = (battWidth - 4) / 4;
  for (int i = 0; i <= frame; i++) {
    display.fillRect(battX + 2 + (i * segmentWidth), battY + 2,
                     segmentWidth - 2, battHeight - 4, SH110X_WHITE);
  }

  // Large lightning bolt
  drawLargeThunder(10, 38, 15);
}

// Draw mini thunder icon in top right corner (for normal display when charging)
void drawMiniThunderIcon() {
  // Mini thunder symbol in top right corner
  int x = 110; // Position from left
  int y = 2;   // Position from top

  // Small lightning bolt (8 pixels)
  display.fillTriangle(x, y, x + 4, y, x, y + 8, SH110X_WHITE);
  display.fillTriangle(x, y + 8, x + 4, y + 8, x + 8, y, SH110X_WHITE);
}

// Draw fully charged icon (checkmark) in top right corner
void drawFullChargedIconCorner() {
  // Mini checkmark in top right corner
  int x = 108;
  int y = 4;

  display.drawLine(x, y + 4, x + 3, y + 7, SH110X_WHITE);
  display.drawLine(x + 3, y + 7, x + 8, y, SH110X_WHITE);
  display.drawLine(x, y + 5, x + 3, y + 8, SH110X_WHITE);
  display.drawLine(x + 3, y + 8, x + 8, y + 1, SH110X_WHITE);
}

// Draw large lightning bolt for full-screen animation
void drawLargeThunder(int x, int y, int size) {
  // Large lightning bolt for full screen
  display.fillTriangle(x, y, x + size / 2, y, x, y + size, SH110X_WHITE);
  display.fillTriangle(x, y + size, x + size / 2, y + size, x + size, y,
                       SH110X_WHITE);
}

// ===== END FULL-SCREEN CHARGING ANIMATION FUNCTIONS =====

// --- WiFi Auto-Reconnect Variables (legacy, used by checkWiFiConnection) ---
// Note: lastReconnectAttempt and RECONNECT_INTERVAL declared globally above
unsigned long lastWiFiCheck = 0;
unsigned long wifiCheckInterval = 30000;
unsigned long reconnectDelay = 1000;
unsigned long maxReconnectDelay = 30000;
int reconnectAttempts = 0;
int maxReconnectAttempts = 10;
bool wifiReconnectInProgress = false;
String lastWiFiStatus = "";
int wifiRSSI = 0;
unsigned long wifiConnectedTime = 0;

// --- Debug and Utility Functions ---
void debugPrint(String message, bool newline) {
#if !PRODUCTION_MODE
  String timestamp = "[" + String(millis()) + "] ";
  if (newline) {
    Serial.println(timestamp + message);
  } else {
    Serial.print(timestamp + message);
  }
#endif
}

void debugPrintWiFiStatus() {
  debugPrint("=== WiFi Status Debug ===");
  debugPrint("WiFi Status: " + String(WiFi.status()));
  debugPrint("WiFi Connected: " + String(wifiConnected ? "YES" : "NO"));
  debugPrint("SSID: " + String(WiFi.SSID()));
  debugPrint("IP Address: " + WiFi.localIP().toString());
  debugPrint("RSSI: " + String(WiFi.RSSI()) + " dBm");
  debugPrint("Reconnect Attempts: " + String(reconnectAttempts));
  debugPrint("Reconnect In Progress: " +
             String(wifiReconnectInProgress ? "YES" : "NO"));
  debugPrint("Uptime: " + String((millis() - wifiConnectedTime) / 1000) +
             " seconds");
  debugPrint("========================");
}

String getWiFiStatusString(wl_status_t status) {
  switch (status) {
  case WL_NO_SSID_AVAIL:
    return "NO_SSID_AVAILABLE";
  case WL_SCAN_COMPLETED:
    return "SCAN_COMPLETED";
  case WL_CONNECTED:
    return "CONNECTED";
  case WL_CONNECT_FAILED:
    return "CONNECT_FAILED";
  case WL_CONNECTION_LOST:
    return "CONNECTION_LOST";
  case WL_DISCONNECTED:
    return "DISCONNECTED";
  case WL_IDLE_STATUS:
    return "IDLE_STATUS";
  default:
    return "UNKNOWN(" + String(status) + ")";
  }
}

void updateWiFiStatus() {
  wl_status_t currentStatus = WiFi.status();
  String statusString = getWiFiStatusString(currentStatus);

  if (statusString != lastWiFiStatus) {
    debugPrint("WiFi Status Changed: " + lastWiFiStatus + " -> " +
               statusString);
    lastWiFiStatus = statusString;
  }

  if (currentStatus == WL_CONNECTED) {
    wifiRSSI = WiFi.RSSI();
    if (!wifiConnected) {
      wifiConnectedTime = millis();
      debugPrint("WiFi Connected Successfully!");
      debugPrint("IP: " + WiFi.localIP().toString());
      debugPrint("RSSI: " + String(wifiRSSI) + " dBm");
    }
    wifiConnected = true;
    reconnectAttempts = 0;
    reconnectDelay = 1000; // Reset delay
    wifiReconnectInProgress = false;
  } else {
    if (wifiConnected) {
      debugPrint("WiFi Connection Lost!");
      wifiConnected = false;
      robridgeConnected = false;
      isRegistered = false;

      // Show WiFi disconnected message on display
      display.clearDisplay();
      displayStatusBar(); // Show status bar with disconnected WiFi icon
      display.setCursor(0, 20);
      display.setTextSize(1);
      display.println("WiFi Disconnected");
      display.println("");
      display.println("To restart:");
      display.println("Hold trigger 10 sec");
      display.display();
    }
  }
}

bool attemptWiFiReconnect() {
  if (wifiReconnectInProgress) {
    return false;
  }

  unsigned long currentTime = millis();
  if (currentTime - lastReconnectAttempt < reconnectDelay) {
    return false;
  }

  if (reconnectAttempts >= maxReconnectAttempts) {
    debugPrint("Max reconnect attempts reached. Resetting attempts.");
    reconnectAttempts = 0;
    reconnectDelay = 1000;
  }

  wifiReconnectInProgress = true;
  lastReconnectAttempt = currentTime;
  reconnectAttempts++;

  debugPrint("WiFi Reconnect Attempt #" + String(reconnectAttempts));
  debugPrint("Current Status: " + getWiFiStatusString(WiFi.status()));

  // Disconnect first to ensure clean connection
  if (WiFi.status() != WL_DISCONNECTED) {
    debugPrint("Disconnecting from WiFi...");
    WiFi.disconnect(true);
  }

  debugPrint("Attempting to connect to: " + String(ssid));

  // Set custom hostname before reconnecting (must be set before WiFi.begin)
  WiFi.setHostname(deviceId.c_str());
  debugPrint("WiFi Hostname set to: " + deviceId);

  // Non-blocking begin
  WiFi.begin(ssid, password);
  wifiAttemptingConnect = true;
  wifiConnectStartTime = millis();

  debugPrint("WiFi started. Checking status in background...");
  return true;
}

void checkWiFiConnection() {
  // This function now cooperates with the event-driven WiFi handler
  // (onWiFiEvent). It only syncs the wifiConnected flag from actual
  // WiFi.status() as a safety net. It NO LONGER calls attemptWiFiReconnect() —
  // that is handled by checkAutoReconnect().

  wl_status_t currentStatus = WiFi.status();

  if (currentStatus == WL_CONNECTED) {
    if (!wifiConnected) {
      // Sync: status says connected but flag wasn't set (edge case)
      wifiConnected = true;
      wifiRSSI = WiFi.RSSI();
      wifiConnectedTime = millis();
      reconnectEnabled = false;
      if (systemState == WIFI_DISCONNECTED || systemState == CONNECTING_WIFI) {
        systemState = READY_TO_SCAN;
      }
      debugPrint("[WiFiCheck] Synced: now connected. IP=" +
                 WiFi.localIP().toString());
    }
    // Log periodic health
    static unsigned long lastHealthCheck = 0;
    if (millis() - lastHealthCheck > 60000) {
      lastHealthCheck = millis();
      debugPrint("[WiFiCheck] Health OK - RSSI: " + String(WiFi.RSSI()) +
                 " dBm");
    }
  } else {
    // Not connected — only update flag, let checkAutoReconnect() handle retries
    if (wifiConnected) {
      // This is a sync for cases where the event was missed
      wifiConnected = false;
      robridgeConnected = false;
      debugPrint("[WiFiCheck] Synced: detected disconnect via polling");
      if (systemState == READY_TO_SCAN || systemState == WIFI_CONNECTED) {
        systemState = WIFI_DISCONNECTED;
      }
      if (!bluetoothMode) {
        reconnectEnabled = true;
        lastReconnectAttempt = millis();
      }
    }
  }
}

// Function to clean raw data
String cleanBarcode(String rawData) {
  Serial.println("Raw barcode data: '" + rawData + "'");
  Serial.println("Raw data length: " + String(rawData.length()));

  // Trim whitespace and control characters
  String cleaned = rawData;
  cleaned.trim();

  // Remove common control characters that might be added by the scanner
  cleaned.replace("\r", "");
  cleaned.replace("\n", "");
  cleaned.replace("\t", "");

  // Check if it's a URL (contains http:// or https://)
  if (cleaned.indexOf("http://") >= 0 || cleaned.indexOf("https://") >= 0) {
    Serial.println("Detected URL barcode, keeping as-is");
    Serial.println("Cleaned URL: '" + cleaned + "'");
    return cleaned;
  }

  // Check if it's an alphanumeric barcode (contains letters)
  bool hasLetters = false;
  for (int i = 0; i < cleaned.length(); i++) {
    char c = cleaned[i];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
      hasLetters = true;
      break;
    }
  }

  if (hasLetters) {
    Serial.println("Detected alphanumeric barcode");
  } else {
    Serial.println("Detected numeric barcode");
  }

  Serial.println("Cleaned data: '" + cleaned + "'");
  return cleaned;
}

// Function to manually wake up sleeping Render servers
void wakeUpRenderServer(String serverURL) {
  debugPrint("Attempting to wake up Render server...");

  // Try simple HTTP GET to wake up the server
  HTTPClient http;
  String httpURL = serverURL;
  if (httpURL.startsWith("https://")) {
    httpURL = "http://" + httpURL.substring(8);
  }

  http.begin(httpURL + "/");
  http.setTimeout(10000);
  http.addHeader("User-Agent", "ESP32-WakeUp/1.0");

  int responseCode = http.GET();
  debugPrint("Wake-up response: HTTP " + String(responseCode));

  if (responseCode > 0) {
    String response = http.getString();
    debugPrint("Wake-up successful! Response: " +
               response.substring(0, min(50, (int)response.length())));
  }

  http.end();
  delay(2000); // Give server time to fully wake up
}

// Function to test server connectivity with retry logic for Render sleep
bool testServerConnection(String serverURL) {
  // Try multiple times to handle Render free tier sleep
  for (int attempt = 1; attempt <= 3; attempt++) {
    debugPrint("=== Connection attempt " + String(attempt) + "/3 ===");

    // First try HTTP (non-secure) to see if it's an SSL issue
    HTTPClient http;

    // Try HTTP first (remove https:// and use http://)
    String httpURL = serverURL;
    if (httpURL.startsWith("https://")) {
      httpURL = "http://" + httpURL.substring(8);
    }

    debugPrint("Testing HTTP connection to: " + httpURL);

    // Try different endpoints
    String endpoints[] = {"/api/health", "/api/esp32/scan", "/health", "/"};

    for (int i = 0; i < 4; i++) {
      String testURL = httpURL + endpoints[i];
      debugPrint("Testing HTTP endpoint: " + testURL);

      http.begin(testURL);
      http.setTimeout(15000); // Longer timeout for sleeping servers
      http.addHeader("User-Agent", "ESP32-Test/1.0");

      int responseCode = http.GET();
      debugPrint("HTTP Response from " + endpoints[i] + ": " +
                 String(responseCode));

      if (responseCode > 0) {
        String response = http.getString();
        debugPrint("HTTP Response: " +
                   response.substring(0, min(100, (int)response.length())));
        http.end();
        debugPrint("Server is awake and responding!");
        return true; // Found a working endpoint
      }

      http.end();
      delay(2000); // Wait between attempts
    }

    // If HTTP fails, try HTTPS with proper SSL setup
    debugPrint("HTTP failed, trying HTTPS with proper SSL setup...");
    WiFiClientSecure client;
    client.setInsecure(); // Skip certificate verification for Render.com

    for (int i = 0; i < 2; i++) { // Only try first 2 endpoints with HTTPS
      String testURL = serverURL + endpoints[i];
      debugPrint("Testing HTTPS endpoint: " + testURL);

      // Proper HTTPS setup
      if (http.begin(client, testURL)) {
        http.setTimeout(20000); // Longer timeout for HTTPS
        http.addHeader("User-Agent", "ESP32-Test/1.0");

        int responseCode = http.GET();
        debugPrint("HTTPS Response from " + endpoints[i] + ": " +
                   String(responseCode));

        if (responseCode > 0) {
          String response = http.getString();
          debugPrint("HTTPS Response: " +
                     response.substring(0, min(100, (int)response.length())));
          http.end();
          debugPrint("HTTPS connection successful!");
          return true;
        }
      } else {
        debugPrint("Failed to begin HTTPS connection to " + testURL);
      }

      http.end();
      delay(2000);
    }

    // If this attempt failed and we have more attempts, wait before retrying
    if (attempt < 3) {
      debugPrint("Attempt " + String(attempt) +
                 " failed. Waiting 5 seconds before retry...");
      debugPrint("erver might be sleeping. Trying to wake it up...");
      delay(5000); // Wait 5 seconds between attempts
    }
  }

  debugPrint(
      "All connection attempts failed. Server may be down or DNS issue.");
  return false;
}

// // Function to analyze product using AI - Fixed Render.com connection
// Product analyzeProductWithAI(String scannedCode) {
//   Product product;
//   product.barcode = scannedCode;

//   if (!wifiConnected) {
//     debugPrint("Cannot analyze product with AI - WiFi not connected");
//     product.name = "WiFi Error";
//     product.type = "Connection";
//     product.details = "WiFi not connected";
//     product.price = "N/A";
//     product.category = "Error";
//     product.location = "Unknown";
//     return product;
//   }

//   debugPrint("Scanned Code: " + scannedCode);
//   unsigned long analysisStartTime = millis();
//   const unsigned long maxAnalysisTime = 45000; // 45 second max timeout

//   // Try multiple connection strategies for Render.com
//   HTTPClient http;
//   bool connectionSuccess = false;
//   String serverUrl = "";

//   // Strategy 1: Try AI server directly (HTTP first)
//   debugPrint("🔔 Strategy 1: Trying AI server directly...");
//   serverUrl = aiServerURL + "/api/esp32/scan";
//   http.begin(serverUrl);
//   http.setTimeout(20000); // 20 second timeout for sleeping servers
//   http.addHeader("Content-Type", "application/json");
//   http.addHeader("User-Agent", "ESP32-Robridge/2.0");

//   String payload =
//       "{\"deviceId\":\"" + deviceId + "\",\"barcodeData\":\"" + scannedCode +
//       "\",\"deviceName\":\"" + deviceName +
//       "\",\"scanType\":\"GM77_SCAN\",\"timestamp\":" + String(millis()) +
//       "}";
//   debugPrint("Payload: " + payload);

//   int httpResponseCode = http.POST(payload);
//   debugPrint("HTTP Response Code: " + String(httpResponseCode));

//   if (httpResponseCode == 200) {
//     connectionSuccess = true;
//     debugPrint("✅ HTTP connection successful!");
//   } else if (httpResponseCode == 307 || httpResponseCode == 301 ||
//              httpResponseCode == 302) {
//     debugPrint("🔄 HTTP redirect detected (Code: " + String(httpResponseCode)
//     +
//                "), following redirect...");
//     http.end();                // Close HTTP connection before trying HTTPS
//     connectionSuccess = false; // Ensure we don't mark as successful yet
//   } else if (httpResponseCode > 0) {
//     connectionSuccess = true;
//     debugPrint("✅ HTTP connection successful!");
//   } else {
//     debugPrint("❌ HTTP failed: " + http.errorToString(httpResponseCode));
//     http.end();
//   }

//   // Strategy 2: Try HTTPS if HTTP didn't work or was redirected
//   if (!connectionSuccess &&
//       (httpResponseCode == 307 || httpResponseCode == 301 ||
//        httpResponseCode == 302 || httpResponseCode <= 0)) {
//     debugPrint("🔔 Strategy 2: Trying HTTPS with SSL setup...");
//     WiFiClientSecure secureClient;
//     secureClient.setInsecure(); // Skip certificate verification for
//     Render.com secureClient.setTimeout(15000); // Reduced timeout to 15
//     seconds

//     serverUrl = aiServerURL + "/api/esp32/scan";
//     debugPrint("Attempting HTTPS connection to: " + serverUrl);

//     if (http.begin(secureClient, serverUrl)) {
//       debugPrint("✅ HTTPS connection initiated");
//       http.setTimeout(15000); // 15 second timeout
//       http.addHeader("Content-Type", "application/json");
//       http.addHeader("User-Agent", "ESP32-Robridge/2.0");

//       debugPrint("HTTPS Payload: " + payload);

//       // Check timeout before making request
//       if (millis() - analysisStartTime > maxAnalysisTime) {
//         debugPrint("⏰ Analysis timeout reached, aborting HTTPS attempt");
//         http.end();
//         httpResponseCode = -1;
//         connectionSuccess = false;
//       } else {
//         debugPrint("Sending HTTPS POST request...");
//         httpResponseCode = http.POST(payload);
//         debugPrint("HTTPS Response Code: " + String(httpResponseCode));
//       }
//     } else {
//       debugPrint("❌ Failed to begin HTTPS connection");
//       httpResponseCode = -1;
//     }

//     if (httpResponseCode > 0) {
//       connectionSuccess = true;
//       debugPrint("✅ HTTPS connection successful!");
//     } else {
//       debugPrint("❌ HTTPS failed: " + http.errorToString(httpResponseCode));
//       http.end();

//       // Strategy 3: Try alternative AI server
//       debugPrint("🔔 Strategy 3: Trying alternative AI server...");
//       serverUrl = aiServerURL + "/api/esp32/scan";
//       http.begin(secureClient, serverUrl);
//       http.setTimeout(30000);
//       http.addHeader("Content-Type", "application/json");
//       http.addHeader("User-Agent", "ESP32-Robridge/2.0");

//       debugPrint("Alternative Payload: " + payload);
//       httpResponseCode = http.POST(payload);
//       debugPrint("Alternative Response Code: " + String(httpResponseCode));

//       if (httpResponseCode > 0) {
//         connectionSuccess = true;
//         debugPrint("✅ Alternative server connection successful!");
//       } else {
//         debugPrint("❌ All connection strategies failed");
//         http.end();
//       }
//     }
//   }

//   if (connectionSuccess && httpResponseCode == 200) {
//     String response = http.getString();
//     debugPrint("Response: " + response);

//     // Parse JSON response
//     StaticJsonDocument<1024> doc;
//     DeserializationError error = deserializeJson(doc, response);

//     if (!error) {
//       // Parse AI server response format (AIAnalysisResponse)
//       if (doc["title"]) {
//         String title = doc["title"] | "Unknown Product";
//         String category = doc["category"] | "Unknown";
//         String description = doc["description"] | "No description available";

//         debugPrint("✅ AI Analysis Success!");
//         debugPrint("Title: " + title);
//         debugPrint("Category: " + category);

//         // Fill product info for display
//         product.name = title;
//         product.type = category;
//         product.details = description;
//         product.price = "N/A";
//         product.category = category;
//         product.location = "Unknown";
//       } else {
//         debugPrint("❌ No title in response");
//         product.name = "Scanned Code: " + scannedCode;
//         product.type = "Parse Error";
//         product.details = "No title in AI server response";
//         product.price = "N/A";
//         product.category = "Unknown";
//         product.location = "Unknown";
//       }

//     } else {
//       debugPrint("❌ JSON parse failed: " + String(error.c_str()));
//       product.name = "Scanned Code: " + scannedCode;
//       product.type = "Parse Error";
//       product.details = "JSON parsing failed: " + String(error.c_str());
//       product.price = "N/A";
//       product.category = "Unknown";
//       product.location = "Unknown";
//     }
//   } else if (connectionSuccess) {
//     // Server responded but with error code
//     String response = http.getString();
//     debugPrint("Server Error Response: " + response);
//     debugPrint("Response length: " + String(response.length()));

//     if (response.length() == 0) {
//       debugPrint(
//           "⚠️ Empty response - server might be redirecting or have an issue");
//       product.name = "Scanned Code: " + scannedCode;
//       product.type = "Redirect/Empty";
//       product.details = "Server returned empty response (HTTP " +
//                         String(httpResponseCode) + ")";
//       product.price = "N/A";
//       product.category = "Unknown";
//       product.location = "Unknown";
//     } else {
//       product.name = "Scanned Code: " + scannedCode;
//       product.type = "Server Error";
//       product.details = "HTTP " + String(httpResponseCode) + ": " + response;
//       product.price = "N/A";
//       product.category = "Unknown";
//       product.location = "Unknown";
//     }
//   } else {
//     // All connection attempts failed
//     product.name = "Scanned Code: " + scannedCode;
//     product.type = "Connection Failed";
//     product.details =
//         "Cannot connect to AI servers. Check internet connection.";
//     product.price = "N/A";
//     product.category = "Unknown";
//     product.location = "Unknown";
//   }

//   http.end();

//   // Final timeout check
//   unsigned long analysisTime = millis() - analysisStartTime;
//   debugPrint("Analysis completed in " + String(analysisTime) + "ms");

//   if (analysisTime > maxAnalysisTime) {
//     debugPrint("⚠️ Analysis took too long, may have timed out");
//     product.name = "Scanned Code: " + scannedCode;
//     product.type = "Timeout";
//     product.details = "Analysis timed out after " + String(analysisTime) +
//     "ms"; product.price = "N/A"; product.category = "Unknown";
//     product.location = "Unknown";
//   }

//   return product;
// }

// ---------------------------------------------------------------
// Helper function to check for 10-second trigger hold restart
// Can be called from anywhere, including blocking operations
// ---------------------------------------------------------------
void checkTriggerRestart() {
  static unsigned long triggerPressStart = 0;
  static bool triggerHoldDetected = false;

  int buttonState = digitalRead(GM77_TRIG_PIN);

  if (buttonState == LOW) { // Trigger button pressed
    if (triggerPressStart == 0) {
      triggerPressStart = millis();
      triggerHoldDetected = false;
      Serial.println(
          "🔘 Trigger button PRESSED - hold for 10 seconds to restart");
    }

    unsigned long holdDuration = millis() - triggerPressStart;

    // Check if held for 10 seconds
    if (holdDuration >= 10000 && !triggerHoldDetected) {
      triggerHoldDetected = true;
      Serial.println("✅ 10 SECONDS REACHED - RESTARTING NOW!");

      // Show restart message
      display.clearDisplay();
      display.setTextSize(1);
      display.setTextColor(SH110X_WHITE);
      display.setCursor(0, 20);
      display.println("Scanner Restarting...");
      display.println("");
      display.println("Please wait...");
      display.display();
      delay(1000);

      ESP.restart();
    }
  } else {
    // Button released - reset timer
    if (triggerPressStart != 0) {
      Serial.println("🔘 Trigger button RELEASED");
    }
    triggerPressStart = 0;
    triggerHoldDetected = false;
  }
}

/* ----------------------------------------------------------
   Non-blocking Auto-Reconnect (Issue #2 Fix)
   Called from loop() every iteration. Uses 5-second millis timer.
---------------------------------------------------------- */
void checkAutoReconnect() {
  if (!reconnectEnabled || bluetoothMode)
    return;
  if (wifiConnected) {
    reconnectEnabled = false;
    return;
  }

  unsigned long now = millis();
  if (now - lastReconnectAttempt >= RECONNECT_INTERVAL) {
    lastReconnectAttempt = now;
    Serial.println("[Reconnect] Attempting WiFi.reconnect()...");
    WiFi.reconnect();
    systemState = CONNECTING_WIFI;

    // Update display to show reconnecting state (non-blocking)
    if (!blockDisplayUpdates) {
      display.clearDisplay();
      displayStatusBar();
      display.setCursor(0, 20);
      display.println("Reconnecting...");
      display.display();
    }
  }
}

/* ----------------------------------------------------------
   Auto-connect + OLED feedback
---------------------------------------------------------- */
void connectWiFi() {
  // Register WiFi event handler
  WiFi.onEvent(onWiFiEvent);

  // BLOCK display updates from other sources (battery, etc.)
  blockDisplayUpdates = true;

  // 1. Prepare for connection
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(deviceNameid.c_str()); // Broadcast name to hub early
  debugPrint("Network name set: " + deviceNameid);

  // 2. Identify target SSID
  wifiPrefs.begin("wifi_creds", true);
  String targetSSID = wifiPrefs.getString("ssid", "");
  String targetPass = wifiPrefs.getString("password", "");
  wifiPrefs.end();

  // If no specific credentials in Preferences, use ESP32's last saved
  if (targetSSID.length() == 0) {
    targetSSID = WiFi.SSID();
    debugPrint("Using flash auto-connect SSID: " + targetSSID);
  } else {
    debugPrint("Using Preferred (QR/Manual) SSID: " + targetSSID);
  }

  // 3. Display connection message
  display.clearDisplay();
  displayStatusBar();
  display.setCursor(0, 15);
  display.println(F("Auto-connecting..."));
  display.println("");
  if (targetSSID.length() > 0) {
    display.print(F("To: "));
    display.println(targetSSID.substring(0, 16));
  } else {
    display.println(F("Searching network..."));
  }
  display.display();

  // 4. Start Connection
  if (targetSSID.length() > 0 && targetPass.length() > 0) {
    WiFi.begin(targetSSID.c_str(), targetPass.c_str());
  } else {
    WiFi.begin(); // Use system flash
  }

  // 5. Wait for connection (15 second timeout)
  uint8_t tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 15) {
    checkTriggerRestart();
    delay(100);
    static int pDelayCount = 0;
    pDelayCount++;
    if (pDelayCount >= 10) {
      tries++;
      pDelayCount = 0;
      Serial.print(".");
    }
  }
  Serial.println("");

  // 6. Handle Result
  if (WiFi.status() == WL_CONNECTED) {
    deviceIP = WiFi.localIP().toString();
    wifiConnected = true;

    display.clearDisplay();
    displayStatusBar();
    display.setCursor(0, 20);
    display.println(F("WiFi Connected!"));
    display.println(F("IP: "));
    display.println(deviceIP);
    display.display();
    delay(2000);

    loadServerConfig();
    registerWithRobridge();

    WiFi.setAutoReconnect(false);
    WiFi.setSleep(false);
    reconnectEnabled = true;
    systemState = READY_TO_SCAN;

    // Unblock if not in silent mode (initial boot sequence)
    if (!silentWiFiMode) {
      blockDisplayUpdates = false;
    }
    return;
  }

  // ===== Auto-connect failed — return cleanly so caller can proceed to
  // QR/Manual =====
  debugPrint("Auto-connect failed — returning to allow QR scan step.");
  display.clearDisplay();
  displayStatusBar();
  display.setCursor(0, 18);
  display.println(F("Auto-connect"));
  display.println(F("failed."));
  display.println(F(""));
  display.println(F("Try QR scan..."));
  display.display();

  unsigned long msgStart = millis();
  while (millis() - msgStart < 1500) {
    checkTriggerRestart();
    delay(10);
  }

  wifiConnected = false;
  // Unblock if not in silent mode
  if (!silentWiFiMode) {
    blockDisplayUpdates = false;
  }
}

// Function to save server configuration to preferences
void saveServerConfig() {
  preferences.begin("robridge", false);
  preferences.putString("server_ip", customServerIP);
  preferences.end();
  debugPrint("Server config saved: " + customServerIP);
}

// Function to load server configuration from preferences
void loadServerConfig() {
  preferences.begin("robridge", true);
  customServerIP = preferences.getString("server_ip", "");
  preferences.end();

  if (customServerIP.length() > 0) {
    updateServerURLs();
    debugPrint("Server config loaded: " + customServerIP);
  } else {
    debugPrint("No custom server config found, using default cloud URLs");
  }
}

// Function to update server URLs based on custom IP
void updateServerURLs() {
  if (customServerIP.length() > 0) {
    if (customServerIP.startsWith("http://") || customServerIP.startsWith("https://")) {
      expressServerURL = customServerIP;
      aiServerURL = "http://10.168.108.1:8000"; // Default fallback
    } else {
      int colon = customServerIP.indexOf(':');
      if (colon > 0) {
        expressServerURL = "http://" + customServerIP;
        String host = customServerIP.substring(0, colon);
        aiServerURL = "http://" + host + ":8000";
      } else {
        expressServerURL = "http://" + customServerIP + ":3001";
        aiServerURL = "http://" + customServerIP + ":8000";
      }
    }
  } else {
    // Default cloud URL fallback
    expressServerURL = "https://test-robrigdge.onrender.com";
    aiServerURL = "https://test-robrigdge-ai.onrender.com";
  }
  debugPrint("Using dynamic IMS server URLs:");
  debugPrint("Express: " + expressServerURL);
  debugPrint("AI: " + aiServerURL);
}

// ---------------------------------------------------------------
// System Lock State Management Functions
// ---------------------------------------------------------------

// Function to load system lock state and offline mode from preferences
void loadLockState() {
  preferences.begin("robridge", true);
  systemLocked = preferences.getBool("sys_locked", true); // Default to locked
  firstBoot = preferences.getBool("first_boot", true); // Default to first boot
  bluetoothMode =
      preferences.getBool("bluetooth_mode", false); // Default to online
  preferences.end();

  if (systemLocked) {
    debugPrint("System is LOCKED - initialization barcode required");
  } else if (firstBoot) {
    debugPrint("First boot complete - showing WiFi choice screen");
  } else {
    debugPrint("System is UNLOCKED - bluetooth mode: " +
               String(bluetoothMode ? "YES" : "NO"));
  }
}

// Function to save unlock state and first boot flag to preferences
void saveLockState() {
  preferences.begin("robridge", false);
  preferences.putBool("sys_locked", false); // Save unlocked state
  preferences.putBool("first_boot", false); // Mark first boot complete
  preferences.end();
  debugPrint("System unlock state saved to non-volatile memory");
}

// Function to save bluetooth mode preference
void saveBluetoothMode(bool bluetooth) {
  preferences.begin("robridge", false);
  preferences.putBool("bluetooth_mode", bluetooth);
  preferences.end();
  debugPrint("Bluetooth mode saved: " + String(bluetooth ? "YES" : "NO"));
}

// Function to save pairing data to preferences
void savePairingData() {
  preferences.begin("robridge", false);
  preferences.putBool("is_paired", isPaired);
  preferences.putString("user_token", userToken);
  preferences.end();
  debugPrint("Pairing data saved - Paired: " + String(isPaired ? "YES" : "NO"));
}

// Function to load pairing data from preferences
void loadPairingData() {
  preferences.begin("robridge", true);
  isPaired = preferences.getBool("is_paired", false);
  userToken = preferences.getString("user_token", "");
  preferences.end();

  if (isPaired) {
    debugPrint("Pairing data loaded - Device is PAIRED");
    debugPrint("User token: " + userToken.substring(0, 20) + "...");
  } else {
    debugPrint("Pairing data loaded - Device is NOT paired");
  }
}

// Function to reset lock state to locked (for testing or factory reset)
void resetLockState() {
  preferences.begin("robridge", false);
  preferences.putBool("sys_locked", true); // Force locked state
  preferences.end();
  systemLocked = true;
  debugPrint(
      "System lock state RESET to locked - initialization barcode required");
}

// Helper function to check for 10-second restart button hold
// Returns true if restart was triggered, false otherwise
// Call this in loops/waits to enable restart from any state
bool checkRestartButton() {
  static unsigned long triggerPressStart = 0;
  static unsigned long lastStatusPrint = 0;

  int buttonState = digitalRead(GM77_TRIG_PIN);

  if (buttonState == LOW) { // Trigger button pressed
    if (triggerPressStart == 0) {
      triggerPressStart = millis();
      Serial.println("🔘 Trigger PRESSED - hold 10s to restart");
    }

    unsigned long holdDuration = millis() - triggerPressStart;

    // Print status every 2 seconds
    if (millis() - lastStatusPrint > 2000) {
      Serial.print("⏱️  Holding for ");
      Serial.print(holdDuration / 1000);
      Serial.println(" seconds...");
      lastStatusPrint = millis();
    }

    // Check if held for 10 seconds
    if (holdDuration >= 10000) {
      Serial.println("✅ 10 SECONDS - RESTARTING!");

      display.clearDisplay();
      display.setTextSize(1);
      display.setTextColor(SH110X_WHITE);
      display.setCursor(0, 20);
      display.println("  Restarting...");
      display.display();
      delay(1000);

      ESP.restart();
      return true; // Never reached, but for clarity
    }
  } else {
    // Button released
    if (triggerPressStart != 0) {
      Serial.println("🔘 Trigger RELEASED");
      triggerPressStart = 0;
      lastStatusPrint = 0;
    }
  }

  return false;
}

// Function to show mode selection screen and wait for user decision
// Returns: 1=Online, 2=Bluetooth, 3=WiFi Setup
int showModeSelectionScreen() {
  debugPrint("Showing mode selection screen...");

  unsigned long startTime = millis();
  const unsigned long SELECTION_TIMEOUT = 10000; // 10 seconds to decide
  int triggerPressCount = 0;
  bool lastTriggerState = HIGH; // Trigger is active LOW
  unsigned long lastPressTime = 0;
  const unsigned long PRESS_TIMEOUT = 2000; // 2 seconds between presses

  // Helper: get mode name from press count (1-indexed, cycles through 3 modes)
  // 0 presses = no selection yet
  // count % 3 == 1 -> WiFi, == 2 -> Bluetooth, == 0 -> WiFi Setup

  while (millis() - startTime < SELECTION_TIMEOUT) {
    // Check for restart button (10-second hold)
    checkRestartButton();

    // Read trigger button state
    bool currentTriggerState = digitalRead(GM77_TRIG_PIN);

    // Detect trigger press (falling edge)
    if (lastTriggerState == HIGH && currentTriggerState == LOW) {
      triggerPressCount++;
      lastPressTime = millis();
      debugPrint("Trigger pressed - count: " + String(triggerPressCount));

      // Work out which mode this count maps to (cycles WiFi ↔ Bluetooth)
      // Odd presses = WiFi, Even presses = Bluetooth
      int modeNow = (triggerPressCount % 2 == 1) ? 1 : 2;

      // Show selected mode name on display
      display.clearDisplay();
      display.setTextSize(1);
      display.setTextColor(SH110X_WHITE);
      display.setCursor(0, 5);
      display.println("  Mode Selection");
      display.println("");
      if (modeNow == 1) {
        display.println("  > WiFi Mode");
        display.println("");
        display.println("  Press again for");
        display.println("  Bluetooth");
      } else {
        display.println("  > Bluetooth Mode");
        display.println("");
        display.println("  Press again for");
        display.println("  WiFi");
      }
      display.display();
    }

    lastTriggerState = currentTriggerState;

    // Commit selection after PRESS_TIMEOUT with no new press
    if (triggerPressCount > 0 && (millis() - lastPressTime > PRESS_TIMEOUT)) {
      int selectedMode = (triggerPressCount % 2 == 1) ? 1 : 2;

      display.clearDisplay();
      display.setTextSize(1);
      display.setTextColor(SH110X_WHITE);
      display.setCursor(0, 20);

      if (selectedMode == 1) {
        debugPrint("WiFi Mode confirmed");
        display.println("  WiFi Mode");
        display.println("  Starting WiFi...");
        display.display();
        delay(1500);
        return 1;
      } else {
        debugPrint("Bluetooth Mode confirmed");
        display.println("  Bluetooth Mode");
        display.println("  Enabled");
        display.display();
        delay(2000);
        return 2;
      }
    }

    // Update idle display (only when no presses yet)
    if (triggerPressCount == 0) {
      int secondsLeft = (SELECTION_TIMEOUT - (millis() - startTime)) / 1000 + 1;
      display.clearDisplay();
      display.setTextSize(1);
      display.setTextColor(SH110X_WHITE);
      display.setCursor(0, 5);
      display.println("  Select Mode:");
      display.println("");
      display.println("  1x = WiFi");
      display.println("  2x = Bluetooth");
      display.print("  Timeout: ");
      display.print(secondsLeft);
      display.println("s");
      display.setCursor(0, 56);
      if (bluetoothMode) {
        display.print("Default: Bluetooth");
      } else {
        display.print("Default: WiFi");
      }
      display.display();
    }

    delay(50); // Small delay for debouncing
  }

  // Timeout - default to SAVED PREFERENCE
  debugPrint("Timeout - defaulting to saved preference: " +
             String(bluetoothMode ? "Bluetooth" : "WiFi"));

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 20);

  if (bluetoothMode) {
    display.println("  Bluetooth Mode");
    display.println("  (Default)");
    display.display();
    delay(2000);
    return 2; // Default to Bluetooth
  } else {
    display.println("  WiFi Mode");
    display.println("  (Default)");
    display.display();
    delay(2000);
    return 1; // Default to Online
  }
}

// Function effectively handles WiFi QR Scan -> Save -> Connect
// Waits INDEFINITELY (no timeout) until a valid WIFI: QR code is scanned.
// Only a 10-second trigger hold (restart) can exit without scanning.
void setupWiFiViaQR() {
  debugPrint("Entering WiFi Setup Mode (QR Scan) - waiting indefinitely...");
  systemState = QR_SCAN_MODE;

  // Show instructions — no countdown, no timeout
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);
  display.println("WiFi Setup Mode");
  display.println("===============");
  display.println("");
  display.println("Scan WiFi QR Code");
  display.println("to connect...");
  display.println("");
  display.println("(Hold trig 10s rst)");
  display.display();

  // Clear scanner buffer
  while (GM77.available())
    GM77.read();

  String scannedQR = "";
  bool qrFound = false;
  String qrBuffer = "";

  // ===== INFINITE wait loop — exits ONLY when valid WIFI: QR is scanned =====
  while (!qrFound) {
    // Allow 10-second trigger hold to restart device at any time
    checkTriggerRestart();

    // --- Non-blocking QR read ---
    while (GM77.available()) {
      char c = GM77.read();
      if (c == '\n' || c == '\r') {
        if (qrBuffer.length() > 0) {
          scannedQR = qrBuffer;
          qrBuffer = "";
          if (scannedQR.startsWith("WIFI:")) {
            qrFound = true;
          } else {
            // Non-WiFi scan — ignore, show hint
            debugPrint("[QR Wait] Ignored non-WiFi scan: " + scannedQR);
            display.clearDisplay();
            display.setTextSize(1);
            display.setTextColor(SH110X_WHITE);
            display.setCursor(0, 0);
            display.println("WiFi Setup Mode");
            display.println("===============");
            display.println("");
            display.println("Not a WiFi QR!");
            display.println("Please scan a");
            display.println("WiFi config QR.");
            display.display();
            scannedQR = "";
            // After 2 seconds, restore the instructions screen
            unsigned long hintStart = millis();
            while (millis() - hintStart < 2000) {
              checkTriggerRestart();
              delay(10);
            }
            display.clearDisplay();
            display.setCursor(0, 0);
            display.println("WiFi Setup Mode");
            display.println("===============");
            display.println("");
            display.println("Scan WiFi QR Code");
            display.println("to connect...");
            display.println("");
            display.println("(Hold trig 10s rst)");
            display.display();
          }
        }
      } else {
        qrBuffer += c;
      }
    }

    delay(10); // Yield to watchdog
  }

  // QR found — show feedback
  display.clearDisplay();
  display.setCursor(0, 20);
  display.println("QR Detected!");
  display.println("Processing...");
  display.display();

  // Parse, save, then connect
  if (parseWifiQR(scannedQR)) {
    debugPrint("QR Parsed & Saved. Initiating full connection...");
    systemState = CONNECTING_WIFI;
    connectWiFi();
  } else {
    display.clearDisplay();
    display.setCursor(0, 20);
    display.println("Invalid QR!");
    display.println("Please restart");
    display.println("and try again.");
    display.display();
    unsigned long msgStart = millis();
    while (millis() - msgStart < 3000) {
      checkTriggerRestart();
      delay(10);
    }
    ESP.restart();
  }
}

// Function to display locked screen (blank or minimal message)
void displayLockedScreen() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 20);
  display.println("  Scan the Access ");
  display.println("  Barcode in the box");
  display.println("  to Activate");
  display.display();
}

// Function to unlock system and perform full initialization
void unlockSystem() {
  debugPrint("=== UNLOCKING SYSTEM ===");

  // Show unlock message
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 10);
  display.println("  Initialization");
  display.println("  Code Accepted!");
  display.println("");
  display.println("  Activating...");
  display.display();
  delay(2000);

  // Save unlock state permanently (marks first boot as complete)
  saveLockState();
  systemLocked = false;
  firstBoot = false;

  // Show logo
  debugPrint("Displaying startup logo...");
  display.clearDisplay();
  display.drawBitmap(0, 0, epd_bitmap_ro_bridge, 128, 64, 1);
  display.display();
  delay(3000);

  // Show mode selection screen (1x=Online, 2x=Bluetooth, 3x=Scan)
  int selectedMode = showModeSelectionScreen();

  if (selectedMode == 1 ||
      selectedMode == 3) { // 1 or 3 leads to WiFi eventually
    // User chose online or setup mode
    bluetoothMode = false;
    saveBluetoothMode(false);

    if (selectedMode == 1) {
      // Init WiFi immediately
      debugPrint("Starting WiFi connection process...");
      silentWiFiMode = true;
      connectWiFi();

      // If auto-connect failed, fall back to QR scan
      if (!wifiConnected) {
        debugPrint("Auto-connect failed — falling back to WiFi QR scan...");
        setupWiFiViaQR();
      }
    } else {
      // Mode 3: Proceed to WiFi Setup via QR
      debugPrint("Mode 3 Selected - Proceeding to WiFi Setup...");
      setupWiFiViaQR();
    }
  } else {
    // User chose Bluetooth mode (2)
    bluetoothMode = true;
    saveBluetoothMode(true);
    debugPrint("Bluetooth mode selected - skipping WiFi");
  }

  // Show ready message
  debugPrint("System initialization complete. Showing status screen...");
  delay(500); // Small delay to ensure previous display update completes
  displayStatusScreen();

  silentWiFiMode = false;      // EXIT silent mode
  blockDisplayUpdates = false; // FINALLY UNBLOCK after success/unlock
  debugPrint("=== SYSTEM UNLOCKED AND READY ===");
}

void displayStatusBar() {
  // Move status bar down to avoid overlap with main content
  display.drawLine(0, 10, 127, 10, SH110X_WHITE);

  // WiFi / Bluetooth indicator
  if (bluetoothMode) {
    // Show "BLE" text for Bluetooth mode
    display.setTextSize(1);
    display.setTextColor(SH110X_WHITE);
    display.setCursor(2, 2);
    display.print("BLE");
  } else if (WiFi.status() == WL_CONNECTED) {
    // Show WiFi connected icon
    display.fillRect(2, 7, 2, 2, SH110X_WHITE);
    display.fillRect(5, 5, 2, 4, SH110X_WHITE);
    display.fillRect(8, 3, 2, 6, SH110X_WHITE);
    display.fillRect(11, 2, 2, 7, SH110X_WHITE);
  } else {
    // Show WiFi disconnected icon
    display.drawLine(2, 2, 12, 9, SH110X_WHITE);
    display.drawLine(12, 2, 2, 9, SH110X_WHITE);
  }
  // Battery with charging indicator - shows lightning/checkmark when charging
  updateBattery();
  displayBatteryStatus(display, 100,
                       2); // Use smart battery display with charging icons
  // Device ID - smaller font to avoid overlap
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(30, 2);
  display.print("RobridgeAI");
}

// Function to register with Robridge server - Enhanced connection
void registerWithRobridge() {
  if (!wifiConnected) {
    debugPrint("Cannot register with Robridge - WiFi not connected");
    return;
  }

  debugPrint("=== Registering with Robridge Server ===");

  // Create JSON payload
  StaticJsonDocument<200> doc;
  doc["deviceId"] = deviceId;
  doc["deviceName"] = deviceName;
  doc["deviceType"] = "ESP32_Scanner";
  doc["ipAddress"] = WiFi.localIP().toString();
  doc["firmwareVersion"] = firmwareVersion;

  String jsonString;
  serializeJson(doc, jsonString);

  debugPrint("Registration Payload: " + jsonString);

  HTTPClient http;
  bool registrationSuccess = false;

  // Try HTTP first
  String registerUrl = expressServerURL + "/api/esp32/register";
  debugPrint("Trying HTTP registration: " + registerUrl);

  http.begin(registerUrl);
  http.setTimeout(20000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("User-Agent", "ESP32-Robridge/2.0");

  int httpResponseCode = http.POST(jsonString);
  debugPrint("HTTP Registration Response: " + String(httpResponseCode));

  if (httpResponseCode == 200) {
    registrationSuccess = true;
    debugPrint("✅ HTTP registration successful!");
  } else if (httpResponseCode == 307 || httpResponseCode == 301 ||
             httpResponseCode == 302) {
    debugPrint("🔄 HTTP redirect detected (Code: " + String(httpResponseCode) +
               "), following redirect...");
    http.end();
    registrationSuccess = false;
  } else if (httpResponseCode > 0) {
    registrationSuccess = true;
    debugPrint("✅ HTTP registration successful!");
  } else {
    debugPrint("❌ HTTP registration failed: " +
               http.errorToString(httpResponseCode));
    http.end();
  }

  // Try HTTPS if HTTP didn't work or was redirected
  if (!registrationSuccess &&
      (httpResponseCode == 307 || httpResponseCode == 301 ||
       httpResponseCode == 302 || httpResponseCode <= 0)) {
    debugPrint("Trying HTTPS registration...");
    WiFiClientSecure secureClient;
    secureClient.setInsecure();
    secureClient.setTimeout(30000);

    registerUrl = expressServerURL + "/api/esp32/register";
    http.begin(secureClient, registerUrl);
    http.setTimeout(30000);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("User-Agent", "ESP32-Robridge/2.0");

    httpResponseCode = http.POST(jsonString);
    debugPrint("HTTPS Registration Response: " + String(httpResponseCode));

    if (httpResponseCode > 0) {
      registrationSuccess = true;
      debugPrint("✅ HTTPS registration successful!");
    } else {
      debugPrint("❌ HTTPS registration failed: " +
                 http.errorToString(httpResponseCode));
    }
  }

  if (registrationSuccess) {
    String response = http.getString();
    debugPrint("Registration Response: " + response);

    if (httpResponseCode == 200) {
      isRegistered = true;
      robridgeConnected = true;
      debugPrint("✅ Registered with Robridge successfully!");
    } else {
      debugPrint("⚠️ Registration response: HTTP " + String(httpResponseCode));
      robridgeConnected = false;
    }
  } else {
    debugPrint(
        "❌ Robridge registration failed - all connection attempts failed");
    robridgeConnected = false;
  }

  http.end();
  debugPrint("=== Registration Complete ===");
}

// ======================
// DEVICE PAIRING FUNCTIONS
// ======================

// Parse pairing QR code and extract JWT token
// QR Format from mobile app: Contains JWT token for authentication
bool parsePairingQR(String qrData) {
  debugPrint("Parsing pairing QR code...");
  qrData.trim();
  debugPrint("QR Data length: " + String(qrData.length()));

  if (qrData.length() == 6) {
    for (int i = 0; i < 6; i++) {
      if (!isAlphaNumeric(qrData[i])) {
        debugPrint("? Not a pairing QR code - contains non-alphanumeric chars");
        return false;
      }
    }
    debugPrint("? Valid 6-digit IMS pairing code detected.");
    return true;
  } else {
    debugPrint("? Not a pairing QR code - wrong length");
    return false;
  }
}

// Pair device with user account using JWT token
void pairDeviceWithUser(String pairingCode) {
  if (!wifiConnected) {
    debugPrint("❌ Cannot pair - WiFi not connected");
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SH110X_WHITE);
    display.setCursor(0, 0);
    display.println("Pairing Failed");
    display.println("");
    display.println("WiFi not connected");
    display.display();
    delay(3000);
    return;
  }

  // Legacy token check removed for IMS 6-digit code flow

  debugPrint("=== Pairing Device with User ===");

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);
  display.println("Pairing Device...");
  display.println("");
  display.println("Connecting to");
  display.println("server...");
  display.display();

  StaticJsonDocument<200> doc;
  doc["pairingCode"] = pairingCode;
  doc["deviceId"] = deviceId;
  doc["deviceName"] = deviceName;
  doc["deviceType"] = "ESP32_Scanner";
  String jsonString;
  serializeJson(doc, jsonString);
  debugPrint("Pairing Payload: " + jsonString);

  HTTPClient http;
  String pairUrl = expressServerURL + "/api/devices/pair";
  debugPrint("Pairing URL: " + pairUrl);

  bool pairSuccess = false;

  // Try HTTP first
  http.begin(pairUrl);
  http.setTimeout(20000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("User-Agent", "ESP32-Robridge/2.0");

  int httpResponseCode = http.POST(jsonString);
  debugPrint("HTTP Pairing Response Code: " + String(httpResponseCode));

  if (httpResponseCode == 200) {
    pairSuccess = true;
    debugPrint("✅ HTTP pairing successful!");
  } else if (httpResponseCode == 307 || httpResponseCode == 301 ||
             httpResponseCode == 302) {
    debugPrint("🔄 HTTP redirect detected, following redirect...");
    http.end();
    pairSuccess = false;
  } else if (httpResponseCode > 0) {
    pairSuccess = true;
    debugPrint("✅ HTTP pairing successful!");
  } else {
    debugPrint("❌ HTTP pairing failed: " + http.errorToString(httpResponseCode));
    http.end();
  }

  // Try HTTPS if HTTP failed
  if (!pairSuccess &&
      (httpResponseCode == 307 || httpResponseCode == 301 ||
       httpResponseCode == 302 || httpResponseCode <= 0)) {
    debugPrint("Trying HTTPS pairing...");
    WiFiClientSecure secureClient;
    secureClient.setInsecure();
    secureClient.setTimeout(30000);

    http.begin(secureClient, pairUrl);
    http.setTimeout(30000);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("User-Agent", "ESP32-Robridge/2.0");

    httpResponseCode = http.POST(jsonString);
    debugPrint("HTTPS Pairing Response Code: " + String(httpResponseCode));

    if (httpResponseCode == 200 || httpResponseCode > 0) {
      pairSuccess = true;
      debugPrint("✅ HTTPS pairing successful!");
    } else {
      debugPrint("❌ HTTPS pairing failed: " + http.errorToString(httpResponseCode));
    }
  }

  if (pairSuccess) {
    String response = http.getString();
    debugPrint("Pairing Response: " + response);

    isPaired = true;
    savePairingData();
    debugPrint("✅ Device paired successfully!");

    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SH110X_WHITE);
    display.setCursor(0, 0);
    display.println("Paired!");
    display.println("");
    display.setTextSize(2);
    display.println(deviceName);
    display.setTextSize(1);
    display.println("");
    display.println("Ready to scan");
    display.display();
    delay(3000);

    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SH110X_WHITE);
    display.setCursor(0, 0);
    display.println("RoBridge Scanner");
    display.println("Status: Paired");
    display.println("");
    display.println("Scan a barcode");
    display.println("to get started");
    display.display();

  } else {
    String response = http.getString();
    debugPrint("❌ Pairing failed: " + String(httpResponseCode));
    debugPrint("Error response: " + response);

    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SH110X_WHITE);
    display.setCursor(0, 0);
    display.println("Pairing Failed");
    display.println("");
    display.println("Error: " + String(httpResponseCode));
    display.println("");
    display.println("Please try again");
    display.display();
    delay(3000);
  }

  http.end();
  debugPrint("=== Pairing Complete ===");
}

// Function to send ping to Robridge server - Enhanced connection
void sendPingToRobridge() {
  if (!isRegistered || !wifiConnected) {
    debugPrint("Cannot ping Robridge - not registered or WiFi disconnected");
    return;
  }

  debugPrint("Sending ping to Robridge server...");

  HTTPClient http;
  bool pingSuccess = false;

  // Try HTTP first
  String pingUrl = expressServerURL + "/api/esp32/ping/" + deviceId;
  debugPrint("Trying HTTP ping: " + pingUrl);

  http.begin(pingUrl);
  http.setTimeout(15000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("User-Agent", "ESP32-Robridge/2.0");

  int httpResponseCode = http.POST("{}");
  debugPrint("HTTP Ping Response: " + String(httpResponseCode));

  if (httpResponseCode == 200) {
    pingSuccess = true;
    debugPrint("✅ HTTP ping successful!");
  } else if (httpResponseCode == 307 || httpResponseCode == 301 ||
             httpResponseCode == 302) {
    debugPrint("🔄 HTTP redirect detected (Code: " + String(httpResponseCode) +
               "), following redirect...");
    http.end();
    pingSuccess = false;
  } else if (httpResponseCode > 0) {
    pingSuccess = true;
    debugPrint("✅ HTTP ping successful!");
  } else {
    debugPrint("❌ HTTP ping failed: " + http.errorToString(httpResponseCode));
    http.end();
  }

  // Try HTTPS if HTTP didn't work or was redirected
  if (!pingSuccess && (httpResponseCode == 307 || httpResponseCode == 301 ||
                       httpResponseCode == 302 || httpResponseCode <= 0)) {

    // Try HTTPS
    debugPrint("Trying HTTPS ping...");
    WiFiClientSecure secureClient;
    secureClient.setInsecure();
    secureClient.setTimeout(20000);

    pingUrl = expressServerURL + "/api/esp32/ping/" + deviceId;
    http.begin(secureClient, pingUrl);
    http.setTimeout(20000);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("User-Agent", "ESP32-Robridge/2.0");

    httpResponseCode = http.POST("{}");
    debugPrint("HTTPS Ping Response: " + String(httpResponseCode));

    if (httpResponseCode > 0) {
      pingSuccess = true;
      debugPrint("✅ HTTPS ping successful!");
    } else {
      debugPrint("❌ HTTPS ping failed: " +
                 http.errorToString(httpResponseCode));
    }
  }

  if (pingSuccess) {
    if (httpResponseCode == 200) {
      debugPrint("✅ Ping to Robridge successful");
      robridgeConnected = true;
    } else if (httpResponseCode == 404) {
      debugPrint("⚠️ Device not found (404), attempting re-registration...");
      isRegistered = false;
      robridgeConnected = false;
      registerWithRobridge();
    } else {
      debugPrint("⚠️ Ping response: HTTP " + String(httpResponseCode));
    }
  } else {
    debugPrint("❌ All ping attempts failed");
  }

  http.end();
}

// Function to send barcode scan to Robridge server - Enhanced connection
void sendScanToRobridge(String barcodeData, Product *product = nullptr) {
  if (!wifiConnected) {
    debugPrint("Cannot send scan to Robridge - WiFi disconnected");
    return;
  }

  debugPrint("=== Sending Scan to Robridge ===");

  // Create JSON payload
  StaticJsonDocument<500> doc;
  doc["barcodeData"] = barcodeData;
  doc["scanType"] = "GM77_SCAN";
  doc["timestamp"] = getCurrentTimestamp();

  // Include product information if found
  if (product != nullptr) {
    doc["productName"] = product->name;
    doc["productType"] = product->type;
    doc["productDetails"] = product->details;
    doc["productPrice"] = product->price;
    doc["productCategory"] = product->category;
    doc["productLocation"] = product->location;
    doc["source"] = "ai_analysis";
    debugPrint("Product found: " + product->name + " (" + product->type + ")");
    debugPrint("Source: AI Analysis");
  } else {
    doc["source"] = "unknown";
    debugPrint("Product not found - no data available");
  }

  String jsonString;
  serializeJson(doc, jsonString);

  debugPrint("Scan Payload: " + jsonString);

  HTTPClient http;
  bool scanSuccess = false;

  // Try HTTP first
  String scanUrl = expressServerURL + "/api/esp32/scan/" + deviceId;
  debugPrint("Trying HTTP scan: " + scanUrl);

  http.begin(scanUrl);
  http.setTimeout(20000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("User-Agent", "ESP32-Robridge/2.0");

  // Add user token if device is paired for data isolation
  if (isPaired && userToken.length() > 0) {
    // http.addHeader("Authorization", "Bearer " + userToken); // No longer needed for IMS pairing
    debugPrint("✅ Adding user token for authenticated scan");
  } else {
    debugPrint("⚠️ No user token - scan will not be user-specific");
  }

  int httpResponseCode = http.POST(jsonString);
  debugPrint("HTTP Scan Response: " + String(httpResponseCode));

  if (httpResponseCode == 200) {
    scanSuccess = true;
    debugPrint("✅ HTTP scan successful!");
  } else if (httpResponseCode == 307 || httpResponseCode == 301 ||
             httpResponseCode == 302) {
    debugPrint("🔄 HTTP redirect detected (Code: " + String(httpResponseCode) +
               "), following redirect...");
    http.end();
    scanSuccess = false;
  } else if (httpResponseCode > 0) {
    scanSuccess = true;
    debugPrint("✅ HTTP scan successful!");
  } else {
    debugPrint("❌ HTTP scan failed: " + http.errorToString(httpResponseCode));
    http.end();
  }

  // Try HTTPS if HTTP didn't work or was redirected
  if (!scanSuccess && (httpResponseCode == 307 || httpResponseCode == 301 ||
                       httpResponseCode == 302 || httpResponseCode <= 0)) {

    // Try HTTPS
    debugPrint("Trying HTTPS scan...");
    WiFiClientSecure secureClient;
    secureClient.setInsecure();
    secureClient.setTimeout(30000);

    scanUrl = expressServerURL + "/api/esp32/scan/" + deviceId;
    http.begin(secureClient, scanUrl);
    http.setTimeout(30000);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("User-Agent", "ESP32-Robridge/2.0");

    // Add user token if device is paired
    if (isPaired && userToken.length() > 0) {
      // http.addHeader("Authorization", "Bearer " + userToken); // No longer needed for IMS pairing
    }

    httpResponseCode = http.POST(jsonString);
    debugPrint("HTTPS Scan Response: " + String(httpResponseCode));

    if (httpResponseCode > 0) {
      scanSuccess = true;
      debugPrint("✅ HTTPS scan successful!");
    } else {
      debugPrint("❌ HTTPS scan failed: " +
                 http.errorToString(httpResponseCode));
    }
  }

  if (scanSuccess) {
    String response = http.getString();
    debugPrint("Robridge scan response: " + response);

    if (httpResponseCode == 200) {
      debugPrint("✅ Scan sent to Robridge successfully!");
      scanCount++;

      // Parse response to get scan ID
      StaticJsonDocument<100> responseDoc;
      deserializeJson(responseDoc, response);

      if (responseDoc["success"]) {
        String scanId = responseDoc["scanId"];
        debugPrint("Robridge Scan ID: " + scanId);
      }
    } else {
      debugPrint("⚠️ Scan response: HTTP " + String(httpResponseCode));
    }
  } else {
    debugPrint(
        "❌ Failed to send scan to Robridge - all connection attempts failed");
  }

  http.end();
  debugPrint("=== Scan Send Complete ===");
}

// Function to call Gemini API
String callGeminiAPI(String barcodeData) {
  if (!wifiConnected) {
    return "WiFi not connected";
  }

  HTTPClient http;
  http.begin(gemini_api_url + String("?key=") + gemini_api_key);
  http.addHeader("Content-Type", "application/json");

  // Create JSON payload
  String jsonPayload = "{";
  jsonPayload += "\"contents\":[{";
  jsonPayload += "\"parts\":[{";
  jsonPayload += "\"text\":\"Analyze this barcode data and provide information "
                 "about the product: " +
                 barcodeData + "\"";
  jsonPayload += "}]";
  jsonPayload += "}]";
  jsonPayload += "}";

  int httpResponseCode = http.POST(jsonPayload);

  if (httpResponseCode > 0) {
    String response = http.getString();
    http.end();

    // Parse JSON response
    DynamicJsonDocument doc(2048);
    deserializeJson(doc, response);

    if (doc["candidates"][0]["content"]["parts"][0]["text"]) {
      return doc["candidates"][0]["content"]["parts"][0]["text"].as<String>();
    } else {
      return "Error parsing API response";
    }
  } else {
    http.end();
    return "API Error: " + String(httpResponseCode);
  }
}

// Function to display text with scrolling capability
void displayText(String text, int startY = 0) {
  display.clearDisplay();
  displayStatusBar(); // Always show status bar
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);

  // Start content below status bar (y=12)
  int contentStartY = max(startY, 12);
  int y = contentStartY;
  int maxCharsPerLine = 20; // Reduced to prevent overlapping
  int maxLines = (SCREEN_HEIGHT - contentStartY) / 8;
  int currentLine = 0;

  // Split text by newlines first
  String lines[20]; // Increased for scrolling
  int lineCount = 0;
  int lastIndex = 0;

  // Split by \n characters
  for (int i = 0; i <= text.length() && lineCount < 20; i++) {
    if (i == text.length() || text.charAt(i) == '\n') {
      lines[lineCount] = text.substring(lastIndex, i);
      lineCount++;
      lastIndex = i + 1;
    }
  }

  // Process each line with word wrapping
  String processedLines[30]; // Store all processed lines
  int processedLineCount = 0;

  for (int line = 0; line < lineCount; line++) {
    String lineText = lines[line];

    // If line is too long, break it into multiple lines
    while (lineText.length() > maxCharsPerLine) {
      String displayLine = lineText.substring(0, maxCharsPerLine);

      // Try to break at a space
      int breakPoint = displayLine.lastIndexOf(' ');
      if (breakPoint > maxCharsPerLine - 10) { // If space is not too far back
        displayLine = lineText.substring(0, breakPoint);
        lineText = lineText.substring(breakPoint + 1);
      } else {
        lineText = lineText.substring(maxCharsPerLine);
      }

      processedLines[processedLineCount] = displayLine;
      processedLineCount++;
    }

    // Add remaining part of line
    if (lineText.length() > 0) {
      processedLines[processedLineCount] = lineText;
      processedLineCount++;
    }
  }

  // If we have more lines than can fit on screen, implement scrolling
  if (processedLineCount > maxLines) {
    int scrollStart = 0;
    int scrollEnd = min(processedLineCount, maxLines);

    // Show initial content
    for (int i = scrollStart; i < scrollEnd; i++) {
      display.setCursor(0, contentStartY + (i - scrollStart) * 8);
      display.println(processedLines[i]);
    }
    display.display();
    delay(400); // Show initial content for 0.8 seconds (much faster)

    // Scroll through the content
    for (int scroll = 0; scroll <= processedLineCount - maxLines; scroll++) {
      display.clearDisplay();

      for (int i = scroll; i < scroll + maxLines && i < processedLineCount;
           i++) {
        display.setCursor(0, contentStartY + (i - scroll) * 8);
        display.println(processedLines[i]);
      }

      // Add scroll indicator
      if (scroll < processedLineCount - maxLines) {
        display.setCursor(120, SCREEN_HEIGHT - 8);
        display.print("▼");
      } else if (scroll > 0) {
        display.setCursor(120, SCREEN_HEIGHT - 8);
        display.print("▲");
      }

      // Add page indicator

      display.display();
      delay(500); // Show each screen for 1 second (much faster)
    }
  } else {
    // Content fits on screen, display normally
    for (int i = 0; i < processedLineCount; i++) {
      display.setCursor(0, contentStartY + i * 8);
      display.println(processedLines[i]);
    }
    display.display();
    delay(1500); // Show for 1.5 seconds (much faster)
  }
}

// Function to display text without status bar (for clean displays) - WITH
// SCROLLING
void displayTextClean(String text, int startY = 0) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);

  int y = startY;
  int maxCharsPerLine = 20; // Reduced to prevent overlapping
  int maxLines = (SCREEN_HEIGHT - startY) / 8;
  int currentLine = 0;

  // Split text by newlines first
  String lines[20]; // Increased for scrolling
  int lineCount = 0;
  int lastIndex = 0;

  // Split by \n characters
  for (int i = 0; i <= text.length() && lineCount < 20; i++) {
    if (i == text.length() || text.charAt(i) == '\n') {
      lines[lineCount] = text.substring(lastIndex, i);
      lineCount++;
      lastIndex = i + 1;
    }
  }

  // Process each line with word wrapping
  String processedLines[30]; // Store all processed lines
  int processedLineCount = 0;

  for (int line = 0; line < lineCount; line++) {
    String lineText = lines[line];

    // If line is too long, break it into multiple lines
    while (lineText.length() > maxCharsPerLine) {
      String displayLine = lineText.substring(0, maxCharsPerLine);

      // Try to break at a space
      int breakPoint = displayLine.lastIndexOf(' ');
      if (breakPoint > maxCharsPerLine - 10) { // If space is not too far back
        displayLine = lineText.substring(0, breakPoint);
        lineText = lineText.substring(breakPoint + 1);
      } else {
        lineText = lineText.substring(maxCharsPerLine);
      }

      processedLines[processedLineCount] = displayLine;
      processedLineCount++;
    }

    // Add remaining part of line
    if (lineText.length() > 0) {
      processedLines[processedLineCount] = lineText;
      processedLineCount++;
    }
  }

  // If we have more lines than can fit on screen, implement scrolling
  if (processedLineCount > maxLines) {
    int scrollStart = 0;
    int scrollEnd = min(processedLineCount, maxLines);

    // Show initial content
    for (int i = scrollStart; i < scrollEnd; i++) {
      display.setCursor(0, startY + (i - scrollStart) * 8);
      display.println(processedLines[i]);
    }
    display.display();
    delay(800); // Show initial content for 0.8 seconds (much faster)

    // Scroll through the content
    for (int scroll = 0; scroll <= processedLineCount - maxLines; scroll++) {
      display.clearDisplay();

      for (int i = scroll; i < scroll + maxLines && i < processedLineCount;
           i++) {
        display.setCursor(0, startY + (i - scroll) * 8);
        display.println(processedLines[i]);
      }

      // Add scroll indicator
      if (scroll < processedLineCount - maxLines) {
        display.setCursor(120, SCREEN_HEIGHT - 8);
        display.print("▼");
      } else if (scroll > 0) {
        display.setCursor(120, SCREEN_HEIGHT - 8);
        display.print("▲");
      }

      // Add page indicator
      display.setCursor(110, 0);
      display.print(String(scroll + 1) + "/" +
                    String(processedLineCount - maxLines + 1));

      display.display();
      delay(1000); // Show each screen for 1 second (much faster)
    }
  } else {
    // Content fits on screen, display normally
    for (int i = 0; i < processedLineCount; i++) {
      display.setCursor(0, startY + i * 8);
      display.println(processedLines[i]);
    }
    display.display();
    delay(1500); // Show for 1.5 seconds (much faster)
  }
}

// Function to display AI analysis with interactive scrolling - NO STATUS BAR
void displayAIAnalysisWithScroll(String title, String category,
                                 String description) {
  // Limit description to 150 characters for faster scrolling
  String limitedDescription = description;
  if (limitedDescription.length() > 150) {
    limitedDescription = limitedDescription.substring(0, 147) + "...";
  }

  // Create formatted text for display
  String fullText = "AI ANALYSIS:\n";
  fullText += "Title: " + title + "\n";
  fullText += "Category: " + category + "\n";
  fullText += "\nDescription:\n" + limitedDescription;

  displayTextClean(fullText); // Use clean display without status bar
}

// Function to display manual WiFi connect screen
void displayManualConnect() {
  display.clearDisplay();
  displayStatusBar();
  display.setCursor(0, 20);
  display.println(F("Manual connect"));
  display.setCursor(0, 30);
  display.println("AP: " + deviceNameid);
  display.setCursor(0, 40);
  display.println("PWD: " + pwd);
  display.display();
}

// Function to display status screen (Ready to scan) - WITH status bar
// Function to display status screen (Ready to scan or Warnings)
void displayStatusScreen() {
  // If in Manual Connect Mode, show that screen instead!
  if (isManualConnectMode) {
    displayManualConnect();
    return;
  }

  display.clearDisplay();

  // ===== 1. PRIORITY: BATTERY WARNINGS =====
  if (isBatteryWarningActive) {
    if (millis() < batteryWarningEndTime) {
      display.setTextSize(2);
      display.setTextColor(SH110X_WHITE);

      if (batteryWarningType == "CRITICAL") {
        display.setCursor(10, 10);
        display.println("CRITICAL");
        display.setTextSize(1);
        display.setCursor(0, 30);
        display.println("Battery: 5%");
        display.println("Charge Now!");
      } else {
        display.setCursor(5, 15);
        display.println("LOW");
        display.println("BATTERY");
        display.setTextSize(1);
        display.setCursor(20, 50);
        display.print(bat_percentage, 0);
        display.println("%");
      }
      display.display();
      return; // Exit, don't show other status
    } else {
      isBatteryWarningActive = false; // Expired
    }
  }

  // ===== 2. PRIORITY: CHARGING ANIMATION =====
  if (showFullScreenCharging) {
    drawFullScreenCharging();
    display.display();
    return;
  }

  // ===== 3. STANDARD STATUS SCREEN =====
  displayStatusBar(); // Show status bar (battery, wifi icon etc)
  display.setTextSize(2);
  display.setTextColor(SH110X_WHITE);

  // Check Network Status for main message
  if (bluetoothMode && !bleConnected) {
    // Bluetooth Mode - Waiting for connection
    display.setTextSize(1);
    display.setCursor(15, 25);
    display.println("Bluetooth Mode");
    display.setCursor(10, 40);
    display.println("Pair on Phone/PC");
  } else if (!wifiConnected && !bluetoothMode) {
    // Show "Poor Network Connection" if not connected and not in Bluetooth mode
    display.setTextSize(1);
    display.setCursor(15, 25);
    display.println("Poor Network");
    display.setCursor(20, 38);
    display.println("Connection");
  } else {
    // Ready to scan (WiFi Connected or Bluetooth Connected)
    display.setTextSize(2);
    display.setCursor(20, 25); // Centered
    display.println("Ready");
    display.setTextSize(1);
    display.setCursor(30, 45); // Centered
    display.println("to scan");
  }

  display.display();
}

// Function to display AI analysis process
void displayAIAnalysisProcess(String barcodeData) {
  // Step 1: Connecting to AI service
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);
  display.println("AI Analysis Process");
  display.println("==================");
  display.println("");
  display.println("Step 1: Connecting to");
  display.println("Gemini AI service...");
  display.display();
  delay(1500);

  // Step 2: Analyzing barcode
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);
  display.println("AI Analysis Process");
  display.println("==================");
  display.println("");
  display.println("Step 2: Analyzing");
  display.println("barcode data...");
  display.println("Barcode: " + barcodeData);
  display.display();
  delay(1500);

  // Step 3: Processing with AI
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);
  display.println("AI Analysis Process");
  display.println("==================");
  display.println("");
  display.println("Step 3: AI processing");
  display.println("product information...");
  display.println("");
  display.println("Please wait...");
  display.display();
  delay(2000);

  // Call Gemini API for analysis
  String aiResponse = callGeminiAPI(barcodeData);

  // Step 4: Display AI results
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);
  display.println("AI Analysis Complete");
  display.println("===================");
  display.println("");
  display.println("AI Response:");
  display.println(aiResponse.length() > 0 ? "Analysis received"
                                          : "No response");
  display.display();
  delay(3000);

  // If we got a response, show it
  if (aiResponse.length() > 0 && aiResponse != "WiFi not connected" &&
      !aiResponse.startsWith("API Error")) {
    displayTextClean("AI Analysis Result:\n\n" + aiResponse);
    delay(3000); // Faster display
  } else {
    // Show error or fallback message
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SH110X_WHITE);
    display.setCursor(0, 0);
    display.println("AI Analysis Failed");
    display.println("=================");
    display.println("");
    display.println("Reason: " + aiResponse);
    display.println("");
    display.println("Using fallback");
    display.println("identification...");
    display.display();
    delay(3000);
  }
}

String getCurrentTimestamp() {
  // Get current timestamp in ISO format
  // Note: This is a simplified version. For production, use proper time sync
  unsigned long currentTime = millis();
  return String(currentTime);
}

// Logo bitmap data
static const unsigned char PROGMEM logo16_glcd_bmp[] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x70, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x0f, 0xe0, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x00,
    0x78, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0xf8, 0x00, 0x00,
    0xff, 0xf8, 0x00, 0x00, 0x78, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0f, 0xfc, 0x00, 0x00, 0xff, 0x3c, 0x00, 0x00, 0x78, 0x00, 0x0e, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x0f, 0xbe, 0x00, 0x00, 0xff, 0x3e, 0x00, 0x00,
    0x78, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0xbe, 0x00, 0x00,
    0xfe, 0x1e, 0x00, 0x00, 0x30, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0f, 0x9f, 0x00, 0x00, 0xfe, 0x1e, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x0f, 0x9f, 0x00, 0x00, 0x06, 0x3f, 0x00, 0x00,
    0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x1f, 0x00, 0x00,
    0x06, 0x3f, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0f, 0x1f, 0x80, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x0e, 0x0f, 0x80, 0x00, 0xfc, 0xff, 0x00, 0x00,
    0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x0f, 0x80, 0x00,
    0xfd, 0xff, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0e, 0x0f, 0x80, 0xf0, 0x01, 0xff, 0x06, 0x00, 0x70, 0x07, 0x0e, 0x00,
    0x60, 0x00, 0x1c, 0x00, 0x0e, 0x07, 0x83, 0xfc, 0x03, 0xff, 0x07, 0x3c,
    0x70, 0x1f, 0xce, 0x01, 0xf9, 0xc0, 0x7f, 0x00, 0x0e, 0x0f, 0x83, 0xfc,
    0x7f, 0xff, 0x07, 0x7c, 0x70, 0x1f, 0xce, 0x03, 0xf9, 0xc0, 0x7f, 0x80,
    0x0e, 0x8f, 0x87, 0xfe, 0x7f, 0xff, 0x07, 0x78, 0x70, 0x3f, 0xee, 0x07,
    0xfd, 0xc0, 0xff, 0xc0, 0x0f, 0x2f, 0x8f, 0xff, 0x7f, 0xff, 0x07, 0xf8,
    0x70, 0x3c, 0xfe, 0x07, 0x9d, 0xc1, 0xe3, 0xc0, 0x0f, 0xff, 0x0f, 0x0f,
    0x3f, 0x9f, 0x07, 0xf8, 0x70, 0x78, 0x3e, 0x0f, 0x07, 0xc1, 0xc1, 0xe0,
    0x0e, 0x0f, 0x1e, 0x07, 0x3f, 0x8e, 0x07, 0xc0, 0x70, 0x70, 0x1e, 0x0e,
    0x07, 0xc3, 0x80, 0xe0, 0x0e, 0x0f, 0x1e, 0x07, 0xbf, 0x8e, 0x07, 0xc0,
    0x70, 0x70, 0x1e, 0x1e, 0x03, 0xc3, 0x80, 0xe0, 0x0f, 0x0f, 0x1c, 0x03,
    0x9f, 0x04, 0x07, 0x80, 0x70, 0xe0, 0x1e, 0x1c, 0x03, 0xc3, 0x80, 0x60,
    0x0f, 0x1e, 0x1c, 0x03, 0x80, 0x06, 0x07, 0x00, 0x70, 0xe0, 0x0e, 0x1c,
    0x01, 0xc3, 0x00, 0x70, 0x0f, 0x1e, 0x3c, 0x03, 0x9f, 0x0f, 0x07, 0x00,
    0x70, 0xe0, 0x0e, 0x1c, 0x01, 0xc7, 0x00, 0x70, 0x0f, 0xfc, 0x38, 0x01,
    0xdf, 0x8f, 0x07, 0x00, 0x70, 0xe0, 0x0e, 0x18, 0x01, 0xc7, 0x00, 0x70,
    0x0f, 0x1c, 0x38, 0x01, 0xdf, 0x8f, 0x07, 0x00, 0x70, 0xe0, 0x0e, 0x18,
    0x01, 0xc7, 0x00, 0x70, 0x0f, 0x9c, 0x38, 0x01, 0xdf, 0xff, 0x87, 0x00,
    0x70, 0xe0, 0x0e, 0x18, 0x01, 0xc7, 0xff, 0xf0, 0x0f, 0x9c, 0x38, 0x01,
    0xdf, 0xff, 0x87, 0x00, 0x70, 0xe0, 0x0e, 0x18, 0x01, 0xc7, 0xff, 0xf0,
    0x0f, 0x9c, 0x38, 0x01, 0xdf, 0xff, 0x87, 0x00, 0x70, 0xe0, 0x0e, 0x18,
    0x01, 0xc7, 0xff, 0xf0, 0x0f, 0x9c, 0x38, 0x01, 0xdf, 0xff, 0x87, 0x00,
    0x70, 0xe0, 0x0e, 0x18, 0x01, 0xc7, 0x00, 0x00, 0x0f, 0x9e, 0x38, 0x01,
    0x83, 0xff, 0x87, 0x00, 0x70, 0xe0, 0x0e, 0x1c, 0x01, 0xc7, 0x00, 0x00,
    0x0f, 0x9e, 0x3c, 0x03, 0x81, 0xff, 0x87, 0x00, 0x70, 0xe0, 0x0e, 0x1c,
    0x01, 0xc7, 0x00, 0x00, 0x0f, 0x9e, 0x1c, 0x03, 0x9c, 0xff, 0x87, 0x00,
    0x70, 0xe0, 0x0e, 0x1c, 0x01, 0xc3, 0x00, 0x00, 0x0f, 0x9e, 0x1c, 0x03,
    0x9e, 0xff, 0x87, 0x00, 0x70, 0xe0, 0x1e, 0x1c, 0x03, 0xc3, 0x80, 0x60,
    0x0f, 0xbe, 0x1e, 0x07, 0xbe, 0x3f, 0x87, 0x00, 0x70, 0x70, 0x1e, 0x0e,
    0x03, 0xc3, 0x80, 0xe0, 0x0f, 0xbf, 0x1e, 0x07, 0x26, 0x3f, 0x07, 0x00,
    0x70, 0x70, 0x1e, 0x0e, 0x07, 0xc3, 0xc0, 0xe0, 0x0f, 0x9f, 0x0f, 0x0f,
    0x06, 0x1f, 0x07, 0x00, 0x70, 0x78, 0x3e, 0x0f, 0x07, 0xc1, 0xc1, 0xe0,
    0x0f, 0x9f, 0x0f, 0xff, 0x06, 0x1f, 0x07, 0x00, 0x70, 0x3c, 0x6e, 0x07,
    0x9d, 0xc1, 0xf7, 0xc0, 0x0f, 0x9f, 0x07, 0xfe, 0x06, 0x3e, 0x07, 0x00,
    0x70, 0x3f, 0xee, 0x07, 0xfd, 0xc0, 0xff, 0x80, 0x0f, 0x9f, 0x83, 0xfc,
    0xc7, 0x3e, 0x07, 0x00, 0x70, 0x1f, 0xce, 0x03, 0xf9, 0xc0, 0xff, 0x80,
    0x0f, 0x9f, 0x83, 0xf8, 0xe7, 0xfc, 0x07, 0x00, 0x70, 0x0f, 0xce, 0x01,
    0xf1, 0xc0, 0x3f, 0x00, 0x00, 0x00, 0x00, 0xf0, 0xef, 0xe0, 0x06, 0x00,
    0x00, 0x07, 0x00, 0x00, 0x41, 0xc0, 0x1c, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0xc0, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x03, 0x80, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0e, 0x03, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x0e, 0x07, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x0f, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x07, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x07, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xfc, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00};

// ===== [BLE HID] Helper Functions =====

// Send a single HID key press + release
void sendKey(uint8_t modifier, uint8_t keycode) {
  if (!bleConnected || !input)
    return;
  uint8_t msg[]     = {modifier, 0x00, keycode, 0x00, 0x00, 0x00, 0x00, 0x00};
  uint8_t release[] = {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
  input->setValue(msg, sizeof(msg));
  input->notify();
  delay(20);
  input->setValue(release, sizeof(release));
  input->notify();
  delay(20);
}

void sendStringOverBLE(String data) {
  if (!bleConnected) {
    debugPrint("[BLE] Cannot send string - not connected");
    return;
  }
  debugPrint("Sending barcode via Bluetooth");

  if (data.length() == 0) return;

  // Small delay to ensure host is ready to receive
  delay(100);

  Serial.print("[BLE] Typing: ");
  Serial.println(data);
  debugPrint("[BLE] Sending string: " + data);

  for (int i = 0; i < data.length(); i++) {
      char c = data[i];
      uint8_t key = 0;
      uint8_t mod = 0x00;

      bool found = true;
      // Lowercase letters
      if (c >= 'a' && c <= 'z')
        key = (c - 'a') + 0x04;
      // Uppercase letters (Shift)
      else if (c >= 'A' && c <= 'Z') {
        key = (c - 'A') + 0x04;
        mod = 0x02;
      }
      // Numbers
      else if (c >= '1' && c <= '9')
        key = (c - '1') + 0x1E;
      else if (c == '0')
        key = 0x27;

      // Special characters (no shift)
      else if (c == ' ')
        key = 0x2C;
      else if (c == '-')
        key = 0x2D;
      else if (c == '=')
        key = 0x2E;
      else if (c == '[')
        key = 0x2F;
      else if (c == ']')
        key = 0x30;
      else if (c == '\\')
        key = 0x31;
      else if (c == ';')
        key = 0x33;
      else if (c == '\'')
        key = 0x34;
      else if (c == '`')
        key = 0x35;
      else if (c == ',')
        key = 0x36;
      else if (c == '.')
        key = 0x37;
      else if (c == '/')
        key = 0x38;

      // Special characters (with Shift)
      else if (c == '!') {
        key = 0x1E;
        mod = 0x02;
      } else if (c == '@') {
        key = 0x1F;
        mod = 0x02;
      } else if (c == '#') {
        key = 0x20;
        mod = 0x02;
      } else if (c == '$') {
        key = 0x21;
        mod = 0x02;
      } else if (c == '%') {
        key = 0x22;
        mod = 0x02;
      } else if (c == '^') {
        key = 0x23;
        mod = 0x02;
      } else if (c == '&') {
        key = 0x24;
        mod = 0x02;
      } else if (c == '*') {
        key = 0x25;
        mod = 0x02;
      } else if (c == '(') {
        key = 0x26;
        mod = 0x02;
      } else if (c == ')') {
        key = 0x27;
        mod = 0x02;
      } else if (c == '_') {
        key = 0x2D;
        mod = 0x02;
      } else if (c == '+') {
        key = 0x2E;
        mod = 0x02;
      } else if (c == '{') {
        key = 0x2F;
        mod = 0x02;
      } else if (c == '}') {
        key = 0x30;
        mod = 0x02;
      } else if (c == '|') {
        key = 0x31;
        mod = 0x02;
      } else if (c == ':') {
        key = 0x33;
        mod = 0x02;
      } else if (c == '"') {
        key = 0x34;
        mod = 0x02;
      } else if (c == '~') {
        key = 0x35;
        mod = 0x02;
      } else if (c == '<') {
        key = 0x36;
        mod = 0x02;
      } else if (c == '>') {
        key = 0x37;
        mod = 0x02;
      } else if (c == '?') {
        key = 0x38;
        mod = 0x02;
      } else {
        found = false;
      }

      if (key != 0)
        sendKey(mod, key);
    }
    sendKey(0x00, 0x28); // Enter
} // end sendStringOverBLE
// ===== [/BLE HID] Helper Functions =====

void setup() {
  blockDisplayUpdates = true; // Block background updates during initialization
  Serial.begin(115200);
  delay(1000); // Give serial time to initialize

  debugPrint("=== ESP32 GM77 Barcode Scanner Starting ===");
  debugPrint("Firmware Version: " + String(firmwareVersion));
  debugPrint("Device ID: " + String(deviceId));
  debugPrint("Device Name: " + String(deviceName));

  // Init GM77 scanner (baud: 9600, RX=16, TX=17)
  debugPrint("Initializing GM77 barcode scanner...");
  GM77.begin(9600, SERIAL_8N1, 16, 17);
  debugPrint("GM77 scanner initialized on UART2 (GPIO16 RX, GPIO17 TX)");

  debugPrint("Registering WiFi event handler...");
  WiFi.onEvent(onWiFiEvent);
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(deviceNameid.c_str()); // Set hostname immediately
  WiFi.setAutoReconnect(true);

  debugPrint("Initializing OLED display...");
  debugPrint("Trying I2C address 0x3C...");
  if (!display.begin(0x3C, true)) {
    debugPrint("0x3C failed, trying 0x3D...");
    if (!display.begin(0x3D, true)) {
      debugPrint("ERROR: OLED init failed on both 0x3C and 0x3D!");
      debugPrint("Troubleshooting:");
      debugPrint("  1. Check wiring: SDA=GPIO21, SCL=GPIO22");
      debugPrint("  2. Verify 3.3V power (NOT 5V!)");
      debugPrint("  3. Run I2C_Scanner.ino to detect devices");
      debugPrint("  4. Check DISPLAY_TROUBLESHOOTING.md");
      for (;;)
        ;
    } else {
      debugPrint("OLED display initialized successfully at 0x3D");
    }
  } else {
    debugPrint("OLED display initialized successfully at 0x3C");
  }

  // CRITICAL FIX: Clear display buffer immediately after initialization
  // This prevents random garbage/noise from appearing on screen during boot
  display.clearDisplay();
  display.display();
  debugPrint("Display buffer cleared - ready for use");

  // ===== BATTERY INITIALIZATION - COMPLETE REWRITE =====
  debugPrint("=== Initializing Battery System (RESTART-SAFE) ===");

  fuelGauge.begin(DEFER_ADDRESS);
  uint8_t addr = fuelGauge.findFirstDevice();

  if (addr == 0) {
    debugPrint("ERROR: MAX1704X NOT FOUND!");
    voltage = 0.0;
    bat_percentage = 0.0;
    fuelGaugeFound = false;
    batteryStateValid = false;
  } else {
    debugPrint("MAX1704X found at address: 0x" + String(addr, HEX));
    fuelGauge.address(addr);
    fuelGaugeFound = true;

    // ===== STRATEGY 1: LOAD SAVED STATE BEFORE ANY IC OPERATIONS =====
    batteryPrefs.begin("battery", true);
    float savedVoltage = batteryPrefs.getFloat("voltage", 0.0);
    float savedPercentage = batteryPrefs.getFloat("percentage", 0.0);
    unsigned long savedTimestamp = batteryPrefs.getULong("timestamp", 0);
    batteryPrefs.end();

    bool hasSavedState = (savedVoltage > 3500.0 && savedPercentage > 0.0);

    if (hasSavedState) {
      debugPrint("✅ SAVED STATE FOUND:");
      debugPrint("   Voltage: " + String(savedVoltage) + "mV");
      debugPrint("   Percentage: " + String(savedPercentage, 1) + "%");
      debugPrint("   Age: " + String(millis() - savedTimestamp) + "ms");
    } else {
      debugPrint("⚠️ No saved state found - fresh initialization");
    }

    // ===== STRATEGY 2: READ CURRENT VOLTAGE BEFORE ANY RESET =====
    delay(100); // Let IC stabilize
    float currentVoltage = 0;
    int validPreReadings = 0;

    // Take 5 quick readings to get current voltage
    for (int i = 0; i < 10; i++) {
      float v = fuelGauge.voltage();
      if (v > 3500.0 && v < 4500.0) {
        currentVoltage += v;
        validPreReadings++;
      }
      delay(20);
    }

    if (validPreReadings > 0) {
      currentVoltage /= validPreReadings;
      debugPrint("📊 Current voltage (pre-reset): " + String(currentVoltage) +
                 "mV");
    } else {
      currentVoltage = 0;
      debugPrint("⚠️ Failed to read current voltage");
    }

    // ===== STRATEGY 3: DECIDE WHETHER TO RESET IC OR NOT =====
    bool shouldReset = true;

    // DON'T reset if:
    // 1. Voltage is high (>4.0V) - likely full battery restart
    // 2. Saved state exists and matches current voltage
    if (currentVoltage >= 4000.0) {
      debugPrint("🔒 SKIP RESET: Voltage >= 4.0V (preserving SOC)");
      shouldReset = false;
    } else if (hasSavedState && abs(currentVoltage - savedVoltage) < 200.0) {
      debugPrint("🔒 SKIP RESET: Current voltage matches saved state");
      shouldReset = false;
    }

    if (shouldReset) {
      debugPrint("🔄 Performing FULL RESET + QuickStart...");
      fuelGauge.reset();
      delay(250);
      fuelGauge.quickstart();
      delay(250);
    } else {
      debugPrint("⚡ Performing QuickStart ONLY (no reset)...");
      fuelGauge.quickstart();
      delay(250);
    }

    // ===== STRATEGY 4: INTELLIGENT STATE RECOVERY =====
    delay(100); // Let IC stabilize after quickstart

    // Take new readings
    float newVoltages[20];
    int newValidCount = 0;

    debugPrint("📡 Taking stabilization readings...");
    for (int i = 0; i < 40 && newValidCount < 20; i++) {
      float v = fuelGauge.voltage();

      if (v > 3500.0 && v < 4500.0) {
        newVoltages[newValidCount] = v;
        newValidCount++;
        if (newValidCount % 5 == 0) {
          debugPrint("   Reading " + String(newValidCount) + ": " + String(v) +
                     "mV");
        }
      }
      delay(50);
    }

    if (newValidCount > 0) {
      // Calculate average voltage
      float avgVoltage = 0;
      for (int i = 0; i < newValidCount; i++) {
        avgVoltage += newVoltages[i];
      }
      avgVoltage /= newValidCount;

      debugPrint("📊 Average voltage: " + String(avgVoltage) + "mV (from " +
                 String(newValidCount) + " readings)");

      // ===== DECISION TREE FOR PERCENTAGE =====
      float finalPercentage = 0;

      // CASE 1: Saved state exists and voltage is similar (within 200mV)
      if (hasSavedState && abs(avgVoltage - savedVoltage) < 200.0) {
        debugPrint("✅ USING SAVED PERCENTAGE (voltage drift: " +
                   String(abs(avgVoltage - savedVoltage)) + "mV)");
        voltage = avgVoltage;
        finalPercentage = savedPercentage;

        // Adjust slightly based on voltage change
        float voltageDrift = avgVoltage - savedVoltage;
        if (voltageDrift > 50.0) {
          finalPercentage =
              min(100.0f, finalPercentage + 2.0f); // Slight increase
        } else if (voltageDrift < -50.0) {
          finalPercentage =
              max(0.0f, finalPercentage - 2.0f); // Slight decrease
        }
      }
      // CASE 2: High voltage (>4.0V) - calculate from voltage with tight
      // mapping
      else if (avgVoltage >= 4000.0) {
        debugPrint("✅ HIGH VOLTAGE DETECTED - Using tight high-range mapping");
        voltage = avgVoltage;
        float vVolts = avgVoltage / 1000.0;

        // Ultra-tight mapping for high voltages
        if (vVolts >= 4.15) {
          finalPercentage = 100.0;
        } else if (vVolts >= 4.10) {
          finalPercentage = 98.0 + ((vVolts - 4.10) / (4.15 - 4.10)) * 2.0;
        } else if (vVolts >= 4.05) {
          finalPercentage = 95.0 + ((vVolts - 4.05) / (4.10 - 4.05)) * 3.0;
        } else if (vVolts >= 4.00) {
          finalPercentage = 90.0 + ((vVolts - 4.00) / (4.05 - 4.00)) * 5.0;
        } else {
          finalPercentage = 90.0; // Should not reach here in this case
        }
      }
      // CASE 3: Medium/Low voltage - use multi-range mapping
      else {
        debugPrint("📊 MEDIUM/LOW VOLTAGE - Using multi-range mapping");
        voltage = avgVoltage;
        float vVolts = avgVoltage / 1000.0;

        if (vVolts >= 3.9) {
          finalPercentage = 70.0 + ((vVolts - 3.9) / (4.0 - 3.9)) * 20.0;
        } else if (vVolts >= 3.7) {
          finalPercentage = 30.0 + ((vVolts - 3.7) / (3.9 - 3.7)) * 40.0;
        } else if (vVolts >= 3.5) {
          finalPercentage = 10.0 + ((vVolts - 3.5) / (3.7 - 3.5)) * 20.0;
        } else if (vVolts >= 3.3) {
          finalPercentage = ((vVolts - 3.3) / (3.5 - 3.3)) * 10.0;
        } else {
          finalPercentage = 0.0;
        }
      }

      // Clamp final percentage
      if (finalPercentage > 100.0)
        finalPercentage = 100.0;
      if (finalPercentage < 0.0)
        finalPercentage = 0.0;

      bat_percentage = finalPercentage;
      batteryStateValid = true;

      debugPrint("✅ BATTERY INITIALIZED:");
      debugPrint("   Voltage: " + String(voltage) + "mV");
      debugPrint("   Percentage: " + String(bat_percentage, 1) + "%");
      debugPrint("   Method: " +
                 String(hasSavedState && abs(avgVoltage - savedVoltage) < 200.0
                            ? "Saved State"
                        : avgVoltage >= 4000.0 ? "High-Voltage Mapping"
                                               : "Standard Mapping"));

      // ===== SAVE NEW STATE IMMEDIATELY =====
      batteryPrefs.begin("battery", false);
      batteryPrefs.putFloat("voltage", voltage);
      batteryPrefs.putFloat("percentage", bat_percentage);
      batteryPrefs.putULong("timestamp", millis());
      batteryPrefs.end();
      lastBatterySave = millis();
      debugPrint("💾 Initial battery state saved");

    } else {
      debugPrint("❌ FAILED TO GET VALID READINGS!");

      // Fallback: Use saved state if available
      if (hasSavedState) {
        debugPrint("🔄 FALLBACK: Using saved state");
        voltage = savedVoltage;
        bat_percentage = savedPercentage;
        batteryStateValid = true;
      } else {
        debugPrint("⚠️ No fallback available - defaulting to 0%");
        voltage = 0.0;
        bat_percentage = 0.0;
        batteryStateValid = false;
      }
    }

    batteryInitTime = millis();
  }

  // ===== CONFIGURE CHARGING DETECTION PIN =====
  debugPrint("Configuring charging detection pin...");
  pinMode(CHARGING_PIN, INPUT_PULLUP); // CHRG pin from charger IC (active LOW)

  // Light Sleep GPIO Wake Configuration - Wake on trigger button press
  debugPrint("Configuring GPIO wake-up for light sleep...");
  pinMode(GM77_TRIG_PIN, INPUT_PULLUP); // Configure trigger pin with pull-up
  gpio_wakeup_enable((gpio_num_t)GM77_TRIG_PIN,
                     GPIO_INTR_LOW_LEVEL); // Wake on trigger press (LOW)
  esp_sleep_enable_gpio_wakeup();
  lastActivityTime = millis();
  debugPrint("Wake-on-trigger configured (GPIO 35) - Press trigger to wake "
             "from sleep");

  // ===== CHECK SYSTEM LOCK STATE =====
  // Do this AFTER hardware initialization but BEFORE showing any screens
  debugPrint("Checking system lock state...");

  // TEMPORARY: Force reset to locked state (comment out after first boot)
  // resetLockState();

  loadLockState();
  loadPairingData(); // Load pairing data from preferences

  if (systemLocked) {
    // System is locked - skip logo, WiFi, battery warnings, and server
    // registration
    debugPrint("System is LOCKED - waiting for initialization barcode");
    displayLockedScreen();
    debugPrint("=== System in Locked State - Scan " + INIT_BARCODE +
               " to unlock ===");
    return; // Exit setup early, skip all initialization
  }
  // ===== END SYSTEM LOCK CHECK =====

  // ===== SYSTEM IS UNLOCKED - PROCEED WITH NORMAL INITIALIZATION =====
  debugPrint("System is UNLOCKED - proceeding with normal initialization");

  // Register WiFi event handler EARLY — must be before any WiFi.begin() call
  // This ensures instant disconnect/reconnect detection is always active
  WiFi.onEvent(onWiFiEvent);
  debugPrint("WiFi event handler registered");

  // Show logo
  debugPrint("Displaying startup logo...");
  display.clearDisplay();
  display.drawBitmap(0, 0, epd_bitmap_ro_bridge, 128, 64, 1);
  display.display();
  delay(3000);

  // Show mode selection screen on every boot

  int selectedMode = showModeSelectionScreen();

  if (selectedMode == 1) {
    // Mode 1: Auto-connect → if still not connected, QR scan → manual connect
    bluetoothMode = false;
    saveBluetoothMode(false);

    // Initialize WiFi variables
    debugPrint("Initializing WiFi variables...");
    lastWiFiCheck = 0;
    reconnectAttempts = 0;
    wifiReconnectInProgress = false;
    wifiConnected = false;
    robridgeConnected = false;
    isRegistered = false;

    // Step 1: Try auto-connect with saved credentials
    debugPrint("Step 1: Auto-connect with saved credentials...");
    silentWiFiMode = true; // Stay silent during initial sequence
    connectWiFi();

    // Step 2: If auto-connect didn't succeed, try QR scan (fallback: manual
    // connect)
    if (!wifiConnected) {
      debugPrint("Auto-connect failed — Step 2: QR scan / manual connect");
      setupWiFiViaQR();
    }

    // Show ready message
    debugPrint("System initialization complete. Showing status screen...");
    delay(500); // Small delay to ensure previous display update completes
    displayStatusScreen();

    silentWiFiMode = false; // EXIT silent mode
    debugPrint("=== System Ready (WiFi Mode) ===");
  } else {
    // User chose Bluetooth mode — FULLY DISABLE WiFi radio
    bluetoothMode = true;
    saveBluetoothMode(true);
    debugPrint("Bluetooth Mode Active — Disabling WiFi radio");

    // Turn off WiFi radio completely — not needed in Bluetooth mode
    WiFi.disconnect(true, false); // Disconnect without erasing credentials
    wifiConnected = false;
    reconnectEnabled = false;
    debugPrint("WiFi radio OFF (Bluetooth mode)");

    // ===== [BLE HID] Initialise BLE keyboard — ONLY in Bluetooth mode =====
    BLEDevice::init("BVS-Scanner-42");

    esp_ble_auth_req_t auth_req = ESP_LE_AUTH_BOND;
    esp_ble_io_cap_t iocap = ESP_IO_CAP_NONE;
    uint8_t key_size = 16;
    uint8_t init_key = ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK;
    uint8_t rsp_key = ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK;

    esp_ble_gap_set_security_param(ESP_BLE_SM_AUTHEN_REQ_MODE, &auth_req, sizeof(auth_req));
    esp_ble_gap_set_security_param(ESP_BLE_SM_IOCAP_MODE, &iocap, sizeof(iocap));
    esp_ble_gap_set_security_param(ESP_BLE_SM_MAX_KEY_SIZE, &key_size, sizeof(key_size));
    esp_ble_gap_set_security_param(ESP_BLE_SM_SET_INIT_KEY, &init_key, sizeof(init_key));
    esp_ble_gap_set_security_param(ESP_BLE_SM_SET_RSP_KEY, &rsp_key, sizeof(rsp_key));

    BLEServer *pBLEServer = BLEDevice::createServer();
    pBLEServer->setCallbacks(new MyCallbacks());

    hid = new BLEHIDDevice(pBLEServer);
    input = hid->inputReport(1);

    hid->manufacturer()->setValue("Espressif");
    hid->pnp(0x02, 0x045E, 0x0750, 0x0300);
    hid->hidInfo(0x00, 0x01);
    hid->reportMap((uint8_t *)reportMap, sizeof(reportMap));
    hid->startServices();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->setAppearance(0x03C1);
    pAdvertising->addServiceUUID(hid->hidService()->getUUID());
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);
    pAdvertising->setMaxPreferred(0x12);
    pAdvertising->start();
    Serial.println("[BLE] Advertising started! Pair with 'BarcodeScanner'");
    // ===== [/BLE HID] =====

    delay(500);
    displayStatusScreen();
    silentWiFiMode = false;
    debugPrint("=== System Ready (Bluetooth Mode) ===");
  }

  debugPrint(
      "Available debug commands: wifi_status, wifi_reconnect, wifi_scan, help");

  blockDisplayUpdates = false;
}

// ======================
// SYSTEM MAINTENANCE
// ======================

void handleSystemFactoryReset() {
  debugPrint("!!! SYSTEM FACTORY RESET TRIGGERED !!!");

  // Show status
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 10);
  display.println("FACTORY RESET");
  display.println("");
  display.println("Erasing data...");
  display.display();

  // 1. Clear Preferences
  preferences.begin("robridge", false);
  preferences.clear();
  preferences.end();
  debugPrint("Cleared 'robridge' preferences");

  batteryPrefs.begin("battery", false);
  batteryPrefs.clear();
  batteryPrefs.end();
  debugPrint("Cleared 'battery' preferences");

  wifiPrefs.begin("wifi_creds", false);
  wifiPrefs.clear();
  wifiPrefs.end();
  debugPrint("Cleared 'wifi_creds' preferences");

  // 2. Clear WiFi Credentials from system flash
  WiFi.disconnect(true, true); // Erase credentials
  // Optional: Reset WiFiManager settings explicitly
  WiFiManager wm;
  wm.resetSettings();
  debugPrint("Cleared WiFi credentials");

  delay(2000);
  display.println("Restarting...");
  display.display();
  delay(1000);

  // 3. Restart
  ESP.restart();
}

void handleWiFiReconfiguration() {
  debugPrint("!!! WIFI RECONFIGURATION TRIGGERED !!!");

  isManualConnectMode = true;
  blockDisplayUpdates = false;

  // Show AP info on OLED
  display.clearDisplay();
  displayStatusBar();
  display.setCursor(0, 20);
  display.println(F("Manual connect"));
  display.setCursor(0, 30);
  display.println("AP: " + deviceNameid);
  display.setCursor(0, 40);
  display.println("PWD: " + pwd);
  display.display();

  bool credentialsValid = false;
  int maxAttempts = 3;

  for (int attempt = 1; attempt <= maxAttempts && !credentialsValid;
       attempt++) {
    debugPrint("WiFiManager attempt #" + String(attempt) + "/" +
               String(maxAttempts));

    WiFiManager wm;
    wm.setHostname(deviceNameid.c_str()); // Ensure name appears in hotspot list
    wm.resetSettings();
    delay(500);

    // Add custom parameter for server IP
    WiFiManagerParameter custom_server_ip("server_ip", "Server IP Address",
                                          customServerIP.c_str(), 40);
    wm.addParameter(&custom_server_ip);

    wm.setConfigPortalTimeout(240); // 4 minutes
    wm.setConnectRetries(3);
    wm.setConnectTimeout(10);

    debugPrint("Starting WiFiManager portal...");
    bool portalResult = wm.autoConnect(deviceNameid.c_str(), pwd.c_str());

    if (!portalResult) {
      // Portal timeout — sleep and retry (same as Mode 1)
      debugPrint("Portal timeout - entering sleep mode...");
      display.clearDisplay();
      displayStatusBar();
      display.setCursor(0, 20);
      display.println(F("Portal Timeout"));
      display.println(F("Entering Sleep..."));
      display.display();
      unsigned long msgStart = millis();
      while (millis() - msgStart < 2000) {
        checkTriggerRestart();
        delay(10);
      }
      enterLightSleep();
      continue; // retry after wake
    }

    // Credentials submitted — verify
    debugPrint("Credentials submitted, verifying...");
    display.clearDisplay();
    displayStatusBar();
    display.setCursor(0, 18);
    display.println(F("Connecting to:"));
    display.setCursor(0, 28);
    display.println(WiFi.SSID());
    display.setCursor(0, 40);
    display.println(F("Verifying..."));
    display.display();

    for (int i = 0; i < 20; i++) {
      checkTriggerRestart();
      delay(100);
    }

    wl_status_t status = WiFi.status();
    debugPrint("Status: " + getWiFiStatusString(status));

    if (status == WL_CONNECTED) {
      credentialsValid = true;
      isManualConnectMode = false;
      debugPrint("WiFi connected via portal!");

      // Save custom server IP if provided
      String newServerIP = custom_server_ip.getValue();
      if (newServerIP.length() > 0) {
        customServerIP = newServerIP;
        saveServerConfig();
        updateServerURLs();
      }

      deviceIP = WiFi.localIP().toString();
      wifiConnected = true;

      // SYNC: Save portal credentials to Preferences so connectWiFi prioritizes
      // them on reboot
      wifiPrefs.begin("wifi_creds", false);
      wifiPrefs.putString("ssid", WiFi.SSID());
      wifiPrefs.putString("password", WiFi.psk());
      wifiPrefs.end();
      debugPrint("Portal credentials synced to Preferences.");

      // Show success
      display.clearDisplay();
      displayStatusBar();
      display.setCursor(0, 20);
      display.println(F("WiFi Connected!"));
      display.println(F("IP:"));
      display.println(deviceIP);
      display.display();
      unsigned long msgStart = millis();
      while (millis() - msgStart < 2000) {
        checkTriggerRestart();
        delay(10);
      }

      // Same post-connect steps as Mode 1
      loadServerConfig();
      registerWithRobridge();
      WiFi.setAutoReconnect(false);
      WiFi.setSleep(false);
      reconnectEnabled = true;
      systemState = READY_TO_SCAN;
      blockDisplayUpdates = false;
      return; // Done — no restart

    } else {
      // Connection failed
      display.clearDisplay();
      displayStatusBar();
      display.setCursor(0, 12);
      display.println(F("WiFi Error!"));
      display.println(F(""));
      if (status == WL_CONNECT_FAILED) {
        display.println(F("Wrong Password!"));
      } else if (status == WL_NO_SSID_AVAIL) {
        display.println(F("Network Not Found"));
      } else {
        display.println(F("Connection Failed"));
      }

      if (attempt < maxAttempts) {
        display.println(F("Retry in 4 sec..."));
        display.display();
        unsigned long retryStart = millis();
        while (millis() - retryStart < 4000) {
          checkTriggerRestart();
          delay(10);
        }
      } else {
        display.println(F("Max attempts!"));
        display.display();
        unsigned long retryStart = millis();
        while (millis() - retryStart < 3000) {
          checkTriggerRestart();
          delay(10);
        }
      }

      WiFi.disconnect(true);
      delay(500);
    }
  }

  // All attempts failed — stay alive, show offline option
  if (!credentialsValid) {
    debugPrint("All portal attempts failed — staying alive in Bluetooth mode");
    isManualConnectMode = false;
    bluetoothMode = true;
    systemState = READY_TO_SCAN;
    display.clearDisplay();
    displayStatusBar();
    display.setCursor(0, 18);
    display.println(F("Connection Failed"));
    display.println(F(""));
    display.println(F("Running Bluetooth"));
    display.display();
    unsigned long msgStart = millis();
    while (millis() - msgStart < 2500) {
      checkTriggerRestart();
      delay(10);
    }
    blockDisplayUpdates = false;
  }
}

// Helper to encapsulate all barcode actions (extracted from old loop)
void processBarcode(String barcodeData) {
  // =========================================================
  // 0. UNIVERSAL SYSTEM COMMANDS (highest priority, both modes)
  // =========================================================
  if (barcodeData == "Sys-Lock-110") {
    handleSystemFactoryReset();
    return;
  }
  if (barcodeData == "Config-wifi-110") {
    // Only allow manual WiFi reconfiguration in WiFi mode
    if (!bluetoothMode) {
      handleWiFiReconfiguration();
    } else {
      debugPrint("[BT Mode] Config-wifi-110 ignored in Bluetooth mode.");
      display.clearDisplay();
      displayStatusBar();
      display.setCursor(0, 20);
      display.println("WiFi config not");
      display.println("available in BT mode");
      display.display();
      delay(2000);
    }
    return;
  }

  // =========================================================
  // ========= BLUETOOTH MODE — ALL WIFI BLOCKED ============
  // =========================================================
  if (bluetoothMode) {
    // Block WIFI: QR codes — do NOT switch networks in BT mode
    if (barcodeData.startsWith("WIFI:")) {
      debugPrint("[BT Mode] WIFI: QR ignored — WiFi is blocked in BT mode.");
      display.clearDisplay();
      displayStatusBar();
      display.setCursor(0, 20);
      display.println("WiFi QR ignored");
      display.println("(Bluetooth mode)");
      display.display();
      delay(2000);
      return;
    }

    // Block pairing QRs in BT mode (requires WiFi)
    if (barcodeData.startsWith("ROBRIDGE_PAIR|")) {
      debugPrint("[BT Mode] Pairing QR ignored — requires WiFi mode.");
      return;
    }

    // ---- Send barcode data over BLE HID as keyboard ----
    debugPrint("[BT Mode] Processing barcode via BLE HID");
    displayBasicScanInfo(barcodeData);

    if (bleConnected) {
      debugPrint("[BT Mode] Sending barcode via BLE HID keyboard");
      sendStringOverBLE(barcodeData);
    } else {
      debugPrint("[BT Mode] BLE not connected — scan shown on display only");
      display.setCursor(0, 40);
      display.println("BLE not connected");
      display.display();
    }
    return;
  }

  // =========================================================
  // ========= WIFI MODE — ALL BLE BLOCKED ==================
  // =========================================================

  // 1. WiFi QR Scan (Instant Network Switch — WiFi mode only)
  if (barcodeData.startsWith("WIFI:")) {
    debugPrint("[WiFi Mode] WiFi QR detected — switching network");
    WiFi.disconnect(true);
    silentWiFiMode = false;
    if (parseWifiQR(barcodeData)) {
      systemState = CONNECTING_WIFI;
      connectWiFi();
    }
    blockDisplayUpdates = false;
    return;
  }

  // 2. Pairing QR (WiFi mode only)
  if (barcodeData.length() == 6 && parsePairingQR(barcodeData)) {
    pairDeviceWithUser(barcodeData);
    return;
  }

  // 3. Online Scan — Display on OLED + Send to Robridge server (WiFi only)
  displayBasicScanInfo(barcodeData);

  if (wifiConnected && isPaired) {
    debugPrint("[WiFi Mode] Sending scan to Robridge: " + barcodeData);
    sendBasicScanToRobridge(barcodeData);
  } else if (!wifiConnected) {
    debugPrint("[WiFi Mode] WiFi not connected — scan displayed locally only");
  } else if (!isPaired) {
    debugPrint("[WiFi Mode] Device not paired — scan displayed locally only");
    display.setCursor(0, 40);
    display.println("Not paired yet.");
    display.println("Scan pairing QR.");
    display.display();
  }
}

void loop() {
  // ===== BLUETOOTH CONNECTION TRACKING (Instant UI Update) =====
  static bool lastBleConnected = false;
  if (bleConnected != lastBleConnected) {
    if (bleConnected && bluetoothMode && !blockDisplayUpdates) {
      displayStatusScreen(); // Instant transition to "Connected" screen
    }
    lastBleConnected = bleConnected;
  }

  static unsigned long lastHeartbeat = 0;
  if (millis() - lastHeartbeat > 5000) {
    Serial.println("💓 Loop running... (heartbeat every 5s)");
    Serial.print("[STATUS] Mode: ");
    Serial.print(bluetoothMode ? "Bluetooth" : "WiFi");
    Serial.print(" | BLE Connected: ");
    Serial.println(bleConnected ? "YES" : "NO");

    if (!bluetoothMode) {
      Serial.println("SSID     : " + wifiSSID);
      Serial.println("IP       : " + WiFi.localIP().toString());
    }
    lastHeartbeat = millis();
  }

  // Update battery reading every second
  updateBattery();
  monitorBatteryHealth(); // ADD THIS LINE

  // ===== CHECK FOR 10-SECOND TRIGGER HOLD (MANUAL RESTART) =====
  checkTriggerRestart();

  // ===== SYSTEM LOCK CHECK - HIGHEST PRIORITY =====
  if (systemLocked) {
    // System is locked - only check for initialization barcode
    if (GM77.available()) {
      lastActivityTime = millis();
      // Use NON-BLOCKING read here too?
      // Ideally yes, but locked mode is simple. Let's keep it simple for now to
      // avoid breaking init. But wait, the user said "Fix the barcode scanning
      // logic". Let's use the new buffer logic for consistency if possible.
      // Actually, let's keep the locked logic as-is (blocking read) because
      // valid init codes are short and rare.

      String rawData =
          GM77.readStringUntil('\n'); // Keep legacy for locked mode
      String barcodeData = cleanBarcode(rawData);

      if (barcodeData.length() > 0) {
        debugPrint("Barcode scanned while locked: " + barcodeData);
        if (barcodeData == INIT_BARCODE) {
          debugPrint("✅ INITIALIZATION CODE!");
          unlockSystem();
        } else if (barcodeData == "Sys-Lock-110") {
          handleSystemFactoryReset();
        } else {
          // Wrong barcode - show error message
          debugPrint("❌ Invalid barcode - system remains locked");
          display.clearDisplay();
          display.setTextSize(1);
          display.setTextColor(SH110X_WHITE);
          display.setCursor(0, 10);
          display.println("  Invalid Code!");
          display.println("");
          display.println("  Scan the Correct");
          display.println("  Access Barcode");
          display.display();
          delay(2000);
          displayLockedScreen();
        }
        while (GM77.available())
          GM77.read(); // Flush
      }
    }

    // Light Sleep Check for Locked Mode
    unsigned long currentTime = millis();
    if (displayOn && (currentTime - lastActivityTime > SLEEP_TIMEOUT)) {
      enterLightSleep();
    }
    delay(10);
    return;
  }

  // ===== SYSTEM IS UNLOCKED - NORMAL OPERATION =====

  // ===== STATE MACHINE DISPATCH =====
  // Non-blocking auto-reconnect (5s timer) — WiFi mode only
  if (!bluetoothMode) {
    checkAutoReconnect();
  }

  // WiFi state machine (only active in WiFi mode)
  if (!bluetoothMode) {
    static SystemState lastSystemState = BOOT;
    if (systemState != lastSystemState) {
      lastSystemState = systemState;
      if (systemState == WIFI_DISCONNECTED && !blockDisplayUpdates) {
        display.clearDisplay();
        displayStatusBar();
        display.setCursor(0, 20);
        display.setTextSize(1);
        display.setTextColor(SH110X_WHITE);
        display.println("Poor Network");
        display.println("Connection");
        display.println("");
        display.println("Auto-reconnecting...");
        display.display();
      } else if (systemState == READY_TO_SCAN && !blockDisplayUpdates) {
        displayStatusScreen();
      }
    }

    // Debug & WiFi Checks (non-blocking) — WiFi mode only
    checkWiFiConnection();
  }

  if (Serial.available()) {
    lastActivityTime = millis();
    String command = Serial.readStringUntil('\n');
    command.trim();
    if (command == "wifi_status")
      debugPrintWiFiStatus();
    else if (command == "reconnect")
      attemptWiFiReconnect();
    else if (command == "test_keyboard") {
      Serial.println("[BLE] Triggering keyboard test 'HELLO'...");
      sendStringOverBLE("HELLO");
    } else if (command == "help")
      Serial.println(
          "cmds: wifi_status, reconnect, battery_diag, test_keyboard");
    else if (command == "battery_diag")
      diagnoseBatteryIssue();
  }

  // Periodic Ping (only in WiFi mode when connected)
  if (!bluetoothMode && wifiConnected && millis() - lastPingTime > pingInterval) {
    sendPingToRobridge();
    lastPingTime = millis();
  }

  // ===== NON-BLOCKING DISPLAY STATE MACHINE =====
  if (currentDisplayState == DISPLAY_SHOWING_RESULT) {
    if (millis() - displayTimerStart > displayDuration) {
      currentDisplayState = DISPLAY_IDLE;
      scannerBuffer = ""; // Clear buffer when unlocking scanning
      displayStatusScreen();
    }
  }

  // ===== NON-BLOCKING SCANNER LOGIC =====
  static unsigned long lastCharTime = 0;
  while (GM77.available()) {
    lastActivityTime = millis();
    lastCharTime = millis();
    char c = GM77.read();

    // SCAN-BUSY LOCK: If we are currently displaying a result,
    // simply consume and discard incoming data to prevent merging/buffering.
    if (currentDisplayState == DISPLAY_SHOWING_RESULT) {
      // Discard character
      continue;
    }

    if (c == '\n' || c == '\r') {
      if (scannerBuffer.length() > 0)
        scanReady = true;
    } else {
      scannerBuffer += c;
    }
  }

  // TIMEOUT-BASED COMPLETION: If no char for 100ms and buffer not empty,
  // finalize.
  if (!scanReady && scannerBuffer.length() > 0 &&
      (millis() - lastCharTime > 100)) {
    scanReady = true;
    debugPrint("Scan completed via timeout (no newline): " + scannerBuffer);
  }

  if (scanReady) {
    String barcodeData = cleanBarcode(scannerBuffer);
    scannerBuffer = "";
    scanReady = false;

    if (barcodeData.length() > 0) {
      // Duplicate Check
      unsigned long now = millis();
      if (barcodeData == lastScannedCode && (now - lastScanTime) < 2000) {
        // Skip
      } else {
        lastScannedCode = barcodeData;
        lastScanTime = now;
        processBarcode(barcodeData);

        // Trigger Display Timeout
        currentDisplayState = DISPLAY_SHOWING_RESULT;
        displayTimerStart = millis();
        displayDuration =
            (bluetoothMode ? 500 : 2000); // 500ms Bluetooth, 2s online
      }
    }
  }

  // Periodic Display Updates (Charging Anim)
  if (showFullScreenCharging || (isCharging && !showFullScreenCharging)) {
    static unsigned long lastDisp = 0;
    if (millis() - lastDisp > 500) {
      if (currentDisplayState == DISPLAY_IDLE)
        displayStatusScreen();
      lastDisp = millis();
    }
  }

  // Light Sleep Check
  if (displayOn && (millis() - lastActivityTime > SLEEP_TIMEOUT)) {
    enterLightSleep();
  }
  delay(10);
}

// Function to display basic scan info without AI analysis
void displayBasicScanInfo(String barcodeData) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);
  display.println("Barcode: " + barcodeData);
  display.println("");
  display.println("Device: " + deviceName);
  // Removed "processing" text as requested
  display.display();
  // No delay here - handled by main loop state machine
}

// Function to send basic scan data to Robridge server (without AI analysis)
void sendBasicScanToRobridge(String barcodeData) {
  if (!wifiConnected) {
    debugPrint("WiFi not connected, skipping basic scan send");
    return;
  }

  if (!isPaired) {
    debugPrint("Device not paired, skipping basic scan send");
    return;
  }

  String serverUrl = expressServerURL + "/api/esp32/scan/" + deviceId;

  // Create JSON payload for basic scan (no AI analysis)
  String jsonString = "{";
  jsonString += "\"barcodeData\":\"" + barcodeData + "\",";
  jsonString += "\"scanType\":\"basic_scan\",";
  jsonString += "\"timestamp\":" + String(millis()) + ",";
  jsonString += "\"source\":\"esp32_basic\",";
  jsonString += "\"productName\":\"Unknown Product\",";
  jsonString += "\"productType\":\"Unknown\",";
  jsonString += "\"productDetails\":\"Basic scan without AI analysis\",";
  jsonString += "\"productCategory\":\"Unknown\"";
  jsonString += "}";

  debugPrint("Sending basic scan to Robridge: " + jsonString);

  HTTPClient http;
  bool scanSuccess = false;

  // Try HTTP first
  http.begin(serverUrl);
  http.setTimeout(20000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("User-Agent", "ESP32-Robridge/2.0");

  int httpResponseCode = http.POST(jsonString);
  debugPrint("HTTP Basic Scan Response Code: " + String(httpResponseCode));

  if (httpResponseCode == 200) {
    scanSuccess = true;
    debugPrint("✅ HTTP basic scan successful!");
  } else if (httpResponseCode == 307 || httpResponseCode == 301 ||
             httpResponseCode == 302) {
    debugPrint("🔄 HTTP redirect detected, following redirect...");
    http.end();
    scanSuccess = false;
  } else if (httpResponseCode > 0) {
    scanSuccess = true;
    debugPrint("✅ HTTP basic scan successful!");
  } else {
    debugPrint("❌ HTTP basic scan failed: " + http.errorToString(httpResponseCode));
    http.end();
  }

  // Try HTTPS if HTTP failed
  if (!scanSuccess &&
      (httpResponseCode == 307 || httpResponseCode == 301 ||
       httpResponseCode == 302 || httpResponseCode <= 0)) {
    debugPrint("Trying HTTPS basic scan...");
    WiFiClientSecure secureClient;
    secureClient.setInsecure();
    secureClient.setTimeout(30000);

    http.begin(secureClient, serverUrl);
    http.setTimeout(30000);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("User-Agent", "ESP32-Robridge/2.0");

    httpResponseCode = http.POST(jsonString);
    debugPrint("HTTPS Basic Scan Response Code: " + String(httpResponseCode));

    if (httpResponseCode == 200 || httpResponseCode > 0) {
      scanSuccess = true;
      debugPrint("✅ HTTPS basic scan successful!");
    } else {
      debugPrint("❌ HTTPS basic scan failed: " + http.errorToString(httpResponseCode));
    }
  }

  if (scanSuccess) {
    String response = http.getString();
    debugPrint("Basic scan response: " + String(httpResponseCode) + " - " + response);
    lastApiResponse = response;
  }

  http.end();
}

// ---------------------------------------------------------------
// Light Sleep Helper Functions
// ---------------------------------------------------------------
void enterLightSleep() {
  display.clearDisplay();
  display.display();
  display.oled_command(SH110X_DISPLAYOFF);
  displayOn = false;
  Serial.println("Display OFF - Going to light sleep...");
  Serial.flush();

  while (GM77.available())
    GM77.read();
  sleepStartTime = millis();

  esp_light_sleep_start();

  unsigned long sleepDuration = millis() - sleepStartTime;
  Serial.printf("Woke up from light sleep after %lu ms\n", sleepDuration);

  delay(100);

  // Quick wake from light sleep
  Serial.println("Waking from light sleep");
  wakeDisplay(); // Instant wake (~100ms)

  lastActivityTime = millis();
}

void wakeDisplay() {
  display.oled_command(SH110X_DISPLAYON);
  displayOn = true;
  Serial.println("Display ON - resumed");

  // Show appropriate screen based on system lock state and WiFi status
  // Show appropriate screen based on system lock state
  if (systemLocked) {
    displayLockedScreen();
  } else if (isManualConnectMode) {
    // RESTORE MANUAL CONNECT SCREEN
    displayManualConnect();
  } else {
    // ALWAYS show ready status screen (skipping manual connect screen)
    displayStatusScreen();
  }
}

void wakeDisplayInitial() {
  display.oled_command(SH110X_DISPLAYON);
  displayOn = true;
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.println("ROBRIDGE System");
  display.println("Reinitializing...");
  display.display();
  delay(2000);
  Serial.println("Display ON - initial state reset");
}