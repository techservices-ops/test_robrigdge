#!/usr/bin/env python3
"""
Robridge AI System Startup Script
Starts both the AI server (server.py) and the web interface
"""

import subprocess
import sys
import time
import os
import signal
import threading
from pathlib import Path

class RobridgeAISystem:
    def __init__(self):
        self.processes = []
        self.running = True
        
    def start_ai_server(self):
        """Start the AI server (server.py) on port 5000"""
        print("🚀 Starting AI Server (server.py) on port 5000...")
        try:
            process = subprocess.Popen([
                sys.executable, "server.py"
            ], cwd=os.getcwd())
            self.processes.append(("AI Server", process))
            print("✅ AI Server started successfully")
            return True
        except Exception as e:
            print(f"❌ Failed to start AI Server: {e}")
            return False
    
    def start_web_interface(self):
        """Web interface will be started manually by user"""
        print("🌐 Web Interface: Manual start required")
        print("   Please run: cd 'Robridge web' && node server.js")
        return True
    
    def check_health(self):
        """Check if all services are running"""
        print("\n🔍 Checking system health...")
        
        # Check AI server
        try:
            import requests
            response = requests.get("http://localhost:5000/health", timeout=5)
            if response.status_code == 200:
                print("✅ AI Server is healthy")
            else:
                print("⚠️  AI Server responded with status:", response.status_code)
        except Exception as e:
            print(f"❌ AI Server health check failed: {e}")
        
        # Check Web interface (manual)
        print("⚠️  Web Interface: Manual check required")
        print("   Check: http://localhost:3001/api/esp32/devices")
    
    def signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        print("\n🛑 Shutting down Robridge AI System...")
        self.running = False
        self.shutdown()
        sys.exit(0)
    
    def shutdown(self):
        """Shutdown all processes"""
        print("\n🔄 Stopping all services...")
        for name, process in self.processes:
            try:
                print(f"Stopping {name}...")
                process.terminate()
                process.wait(timeout=10)
                print(f"✅ {name} stopped")
            except subprocess.TimeoutExpired:
                print(f"⚠️  {name} didn't stop gracefully, forcing...")
                process.kill()
            except Exception as e:
                print(f"❌ Error stopping {name}: {e}")
    
    def run(self):
        """Main run loop"""
        print("🤖 Robridge AI System Starting...")
        print("=" * 50)
        
        # Set up signal handlers
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)
        
        # Start services
        ai_started = self.start_ai_server()
        web_started = self.start_web_interface()
        
        if not ai_started or not web_started:
            print("❌ Failed to start all services")
            self.shutdown()
            return False
        
        # Wait a bit for services to start
        print("\n⏳ Waiting for services to initialize...")
        time.sleep(5)
        
        # Check health
        self.check_health()
        
        print("\n🎉 AI Server is running!")
        print("=" * 50)
        print("🤖 AI Server: http://localhost:5000")
        print("📊 Health Check: http://localhost:5000/health")
        print("=" * 50)
        print("📋 MANUAL STARTUP REQUIRED:")
        print("1. Backend API: cd 'Robridge web' && node server.js")
        print("2. React Frontend: cd 'Robridge web' && set PORT=3000 && npm start")
        print("=" * 50)
        print("Press Ctrl+C to stop all services")
        
        # Keep running
        try:
            while self.running:
                time.sleep(1)
        except KeyboardInterrupt:
            self.signal_handler(signal.SIGINT, None)

if __name__ == "__main__":
    system = RobridgeAISystem()
    system.run()
