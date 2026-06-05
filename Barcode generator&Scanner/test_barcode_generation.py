git sta#!/usr/bin/env python3
"""
Test script to verify barcode generation is working
"""

import os
import sys
import requests
import json

def test_barcode_generation():
    """Test barcode generation with sample data"""
    
    # Test data
    test_data = {
        "data": "TEST123|Sample Product|Electronics|99.99|Warehouse A|Test description",
        "type": "qr",
        "source": "test",
        "metadata": {
            "product_name": "Sample Product",
            "product_id": "TEST123",
            "category": "Electronics",
            "price": "99.99",
            "description": "Test description",
            "location": "Warehouse A"
        }
    }
    
    print("🧪 Testing barcode generation...")
    print(f"📤 Sending data: {test_data['data']}")
    print(f"📤 Barcode type: {test_data['type']}")
    
    try:
        # Send request to generate barcode
        response = requests.post(
            'http://localhost:5000/generate_barcode',
            headers={'Content-Type': 'application/json'},
            json=test_data
        )
        
        print(f"📥 Response status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Success: {result.get('message')}")
            print(f"🆔 Barcode ID: {result.get('barcode_id')}")
            print(f"📁 Filename: {result.get('filename')}")
            
            # Check if file exists locally
            filename = result.get('filename')
            if os.path.exists(filename):
                file_size = os.path.getsize(filename)
                print(f"✅ File exists locally. Size: {file_size} bytes")
            else:
                print(f"❌ File does not exist locally: {filename}")
            
            # Test image retrieval
            filename_only = result.get('filename').split('/')[-1]
            image_url = f"http://localhost:5000/get_barcode/{filename_only}"
            print(f"🖼️  Testing image retrieval: {image_url}")
            
            img_response = requests.get(image_url)
            print(f"📥 Image response status: {img_response.status_code}")
            
            if img_response.status_code == 200:
                print(f"✅ Image retrieved successfully")
                print(f"📏 Image size: {len(img_response.content)} bytes")
                
                # Check if image is not empty
                if len(img_response.content) > 100:
                    print("✅ Image appears to have content")
                else:
                    print("⚠️  Image seems too small, might be empty")
            else:
                print(f"❌ Failed to retrieve image: {img_response.text}")
                
        else:
            print(f"❌ Error: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection error: Make sure the Python server is running on port 5000")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    test_barcode_generation()
