#!/usr/bin/env python3
"""
Direct test of QR code generation
"""

import qrcode
import os

def test_qr_generation():
    """Test QR code generation directly"""
    
    print("🧪 Testing QR code generation directly...")
    
    # Test data
    test_data = "Apple|Earpods|Electronics|99.99|Warehouse A|Test description"
    
    print(f"📤 Test data: {test_data}")
    
    try:
        # Create QR code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(test_data)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Save to test file
        test_filename = "test_qr.png"
        print(f"💾 Saving to: {test_filename}")
        img.save(test_filename)
        
        # Check if file exists
        if os.path.exists(test_filename):
            file_size = os.path.getsize(test_filename)
            print(f"✅ QR code saved successfully. File size: {file_size} bytes")
            
            # Clean up
            os.remove(test_filename)
            print(f"🧹 Cleaned up test file")
        else:
            print(f"❌ File was not created: {test_filename}")
            
    except Exception as e:
        print(f"❌ Error generating QR code: {e}")

if __name__ == "__main__":
    test_qr_generation()
