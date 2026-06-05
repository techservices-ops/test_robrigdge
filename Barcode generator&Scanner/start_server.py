#!/usr/bin/env python3
"""
Startup script for the Barcode Generator Flask Server
This script ensures the server starts with proper configuration for the React frontend
"""

import os
import sys
import subprocess
import time

def check_dependencies():
    """Check if required Python packages are installed"""
    required_packages = [
        'flask', 'flask_cors', 'qrcode', 'barcode', 'PIL'
    ]
    
    missing_packages = []
    for package in required_packages:
        try:
            __import__(package.replace('-', '_'))
        except ImportError:
            missing_packages.append(package)
    
    if missing_packages:
        print(f"[ERROR] Missing required packages: {', '.join(missing_packages)}")
        print("Please install them using: pip install -r requirements.txt")
        return False
    
    print("[OK] All required packages are installed")
    return True

def install_dependencies():
    """Install required packages from requirements.txt"""
    print("[INFO] Installing required packages...")
    try:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt'])
        print("[OK] Dependencies installed successfully")
        return True
    except subprocess.CalledProcessError:
        print("[ERROR] Failed to install dependencies")
        return False

def start_server():
    """Start the Flask server"""
    print("[START] Starting Barcode Generator Server...")
    print("[INFO] Server will be available at: http://localhost:5000")
    print("[INFO] React frontend should connect to: http://localhost:5000")
    print("[INFO] Available endpoints:")
    print("   - POST /generate_barcode - Generate new barcode")
    print("   - GET /get_barcode/<filename> - Get barcode image")
    print("   - GET /get_barcode_by_id/<barcode_id> - Get barcode details by ID")
    print("   - GET /get_barcode_data/<barcode_id> - Get structured barcode data")
    print("   - GET /list_barcodes - List all barcodes")
    print("   - POST /api/lookup_barcode - Look up barcode in database")
    print("   - GET /health - Health check")
    print("\n[INFO] Keep this terminal open while using the React app")
    print("[INFO] Press Ctrl+C to stop the server")
    print("-" * 50)
    
    try:
        # Import and run the Flask app
        from barcode_generator import app
        app.run(debug=True, host='0.0.0.0', port=5000)
    except KeyboardInterrupt:
        print("\n[STOP] Server stopped by user")
    except Exception as e:
        print(f"[ERROR] Error starting server: {e}")
        return False
    
    return True

def main():
    """Main function"""
    print("[SETUP] Barcode Generator Server Setup")
    print("=" * 50)
    
    # Check if we're in the right directory
    if not os.path.exists('barcode_generator.py'):
        print("[ERROR] Please run this script from the 'Barcode generator&Scanner' directory")
        return
    
    # Check dependencies
    if not check_dependencies():
        print("\n[INFO] Attempting to install dependencies...")
        if not install_dependencies():
            print("[ERROR] Failed to install dependencies. Please install manually:")
            print("   pip install -r requirements.txt")
            return
    
    print("\n[START] Starting server...")
    start_server()

if __name__ == '__main__':
    main()
