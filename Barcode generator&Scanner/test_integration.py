#!/usr/bin/env python3
"""
Test script for the Barcode Generator API
This script tests the main endpoints to ensure they work correctly
"""

import requests
import json
import time

# API base URL
BASE_URL = "http://localhost:5000"

def test_health_check():
    """Test the health check endpoint"""
    print("🔍 Testing health check...")
    try:
        response = requests.get(f"{BASE_URL}/health")
        if response.status_code == 200:
            print("✅ Health check passed")
            print(f"   Response: {response.json()}")
            return True
        else:
            print(f"❌ Health check failed: {response.status_code}")
            return False
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to server. Is it running?")
        return False
    except Exception as e:
        print(f"❌ Health check error: {e}")
        return False

def test_generate_barcode():
    """Test barcode generation"""
    print("\n🔍 Testing barcode generation...")
    
    test_data = {
        "data": "TEST_PRODUCT_123|Sample Product|Electronics|99.99|Warehouse A|Test description",
        "type": "qr",
        "source": "test",
        "metadata": {
            "product_name": "Sample Product",
            "product_id": "TEST_PRODUCT_123",
            "category": "Electronics",
            "price": "99.99",
            "description": "Test description",
            "location": "Warehouse A"
        }
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/generate_barcode",
            json=test_data,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Barcode generation successful")
            print(f"   Barcode ID: {result.get('barcode_id')}")
            print(f"   Filename: {result.get('filename')}")
            print(f"   Type: {result.get('type')}")
            return result
        else:
            print(f"❌ Barcode generation failed: {response.status_code}")
            print(f"   Response: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Barcode generation error: {e}")
        return None

def test_get_barcode_image(filename):
    """Test getting the generated barcode image"""
    if not filename:
        print("❌ No filename provided for image test")
        return False
    
    print(f"\n🔍 Testing image retrieval for: {filename}")
    
    try:
        # Extract just the filename part
        image_filename = filename.split('/')[-1]
        response = requests.get(f"{BASE_URL}/get_barcode/{image_filename}")
        
        if response.status_code == 200:
            print("✅ Image retrieval successful")
            print(f"   Content-Type: {response.headers.get('content-type')}")
            print(f"   Content-Length: {len(response.content)} bytes")
            return True
        else:
            print(f"❌ Image retrieval failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Image retrieval error: {e}")
        return False

def test_list_barcodes():
    """Test listing all barcodes"""
    print("\n🔍 Testing barcode listing...")
    
    try:
        response = requests.get(f"{BASE_URL}/list_barcodes")
        
        if response.status_code == 200:
            result = response.json()
            barcodes = result.get('barcodes', [])
            print(f"✅ Barcode listing successful")
            print(f"   Found {len(barcodes)} barcodes")
            
            if barcodes:
                latest = barcodes[0]
                print(f"   Latest: {latest.get('barcode_id')} - {latest.get('type')}")
            
            return True
        else:
            print(f"❌ Barcode listing failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Barcode listing error: {e}")
        return False

def main():
    """Main test function"""
    print("🧪 Barcode Generator API Integration Test")
    print("=" * 50)
    
    # Test 1: Health check
    if not test_health_check():
        print("\n❌ Server is not running or not accessible")
        print("Please start the server first using: python start_server.py")
        return
    
    # Test 2: Generate barcode
    barcode_result = test_generate_barcode()
    if not barcode_result:
        print("\n❌ Barcode generation test failed")
        return
    
    # Test 3: Get barcode image
    filename = barcode_result.get('filename')
    if not test_get_barcode_image(filename):
        print("\n❌ Image retrieval test failed")
        return
    
    # Test 4: List barcodes
    if not test_list_barcodes():
        print("\n❌ Barcode listing test failed")
        return
    
    print("\n🎉 All tests passed! The integration is working correctly.")
    print("\n📱 You can now:")
    print("   1. Use the React frontend to generate barcodes")
    print("   2. View generated barcodes in the web interface")
    print("   3. Download barcodes as PNG or PDF")
    print("   4. All data is automatically saved to the database")

if __name__ == "__main__":
    main()
