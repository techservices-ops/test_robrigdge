#!/usr/bin/env python3
"""
Start the AI Analysis Server with automatic dependency checking
"""

import sys
import subprocess
import os

def check_dependencies():
    """Check and install required dependencies"""
    required_packages = [
        'fastapi',
        'uvicorn',
        'openai',
        'aiohttp',
        'pydantic'
    ]
    
    missing = []
    for package in required_packages:
        try:
            __import__(package)
        except ImportError:
            missing.append(package)
    
    if missing:
        print(f"❌ Missing packages: {', '.join(missing)}")
        print("📦 Installing dependencies...")
        try:
            subprocess.check_call([
                sys.executable, '-m', 'pip', 'install',
                *missing
            ])
            print("✅ Dependencies installed successfully")
        except subprocess.CalledProcessError:
            print("❌ Failed to install dependencies")
            print("Please install manually: pip install fastapi uvicorn openai aiohttp pydantic")
            return False
    else:
        print("✅ All dependencies are installed")
    
    return True

def check_port():
    """Check if port 8000 is available"""
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    result = sock.connect_ex(('localhost', 8000))
    sock.close()
    
    if result == 0:
        print("⚠️  Warning: Port 8000 is already in use")
        print("The AI server may fail to start")
        return False
    else:
        print("✅ Port 8000 is available")
        return True

def main():
    """Main startup function"""
    print("=" * 60)
    print("🤖 Robridge AI Analysis Server Startup")
    print("=" * 60)
    
    # Check if server.py exists
    if not os.path.exists('server.py'):
        print("❌ server.py not found in current directory")
        print("Please run this script from the project root directory")
        return
    
    print("\n📋 Checking dependencies...")
    if not check_dependencies():
        return
    
    print("\n🔍 Checking port availability...")
    check_port()
    
    print("\n🚀 Starting AI Analysis Server...")
    print("=" * 60)
    print("Server will run on: http://localhost:8000")
    print("Health check: http://localhost:8000/health")
    print("Press Ctrl+C to stop")
    print("=" * 60)
    
    try:
        # Import and run
        subprocess.run([sys.executable, 'server.py'])
    except KeyboardInterrupt:
        print("\n\n✋ AI Server stopped by user")
    except Exception as e:
        print(f"\n❌ Error starting server: {e}")

if __name__ == '__main__':
    main()

