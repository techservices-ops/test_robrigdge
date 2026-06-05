# RobBridge UI

A comprehensive React-based user interface for robot control and barcode management systems, featuring modern design and responsive layout.

## 🚀 Features

### 📊 Dashboard
- **Overview Statistics**: Real-time display of system metrics
- **Quick Actions**: Direct access to all major functions
- **Recent Activity**: Live feed of system events
- **System Status**: Real-time monitoring of database and robot connections

### 📷 Barcode Scanner
- **Camera Scanner**: Live camera feed with barcode detection
- **Image Upload**: Support for uploading barcode images
- **Real-time Processing**: Instant barcode recognition and decoding
- **Database Integration**: Automatic lookup and validation of scanned codes
- **Export Functionality**: Save scan results in multiple formats

### 🏷️ Barcode Generator
- **Custom Barcode Creation**: Generate barcodes with product information
- **Multiple Formats**: Support for Code 128, EAN, UPC, and more
- **Live Preview**: Real-time barcode generation and display
- **Database Integration**: Save generated barcodes to database
- **Export Options**: Download as PNG or PDF

### 🖼️ Image Processing
- **Multiple Input Sources**: Camera capture and file upload
- **Advanced Filters**: Grayscale, brightness, contrast, saturation, blur
- **Real-time Processing**: Live preview of applied effects
- **Side-by-side Comparison**: Original vs. processed image view
- **Export & Save**: Download processed images or save to database

### 🤖 Robot Control Console
- **Manual Control**: Joystick-style directional controls
- **Real-time Telemetry**: Live monitoring of robot status
- **Connection Management**: Easy robot connection/disconnection
- **Emergency Stop**: Prominent emergency stop functionality
- **Speed Control**: Adjustable movement speed settings

### ⚙️ Settings & Configuration
- **Database Setup**: PostgreSQL connection configuration
- **Scanner Configuration**: Camera and device settings
- **User Management**: Account and preference settings
- **System Options**: Performance and behavior configuration

## 🎨 Design System

### Color Palette
- **Primary Blue**: #007ACC (MATLAB/Visual Studio inspired)
- **Success Green**: #34A853 (Database success, connected status)
- **Warning Orange**: #FBBC05 (Alerts, warnings)
- **Error Red**: #EA4335 (Emergency stop, failed operations)
- **Robot Accent**: #00B894 (Teal green for robot controls)

### Typography
- **Primary Text**: #202124 (Dark grey, soft on eyes)
- **Secondary Text**: #5F6368 (Medium grey for labels)
- **Background**: #F5F6F7 (Light grey, clean look)

## 🛠️ Technology Stack

- **Frontend**: React 18 with Hooks
- **Routing**: React Router DOM v6
- **Styling**: CSS3 with custom design system
- **Icons**: React Icons (FontAwesome)
- **Barcode Processing**: Quagga.js, JsBarcode
- **Image Processing**: HTML5 Canvas API
- **PDF Generation**: jsPDF
- **Camera Access**: React Webcam

## 📦 Installation

### Prerequisites
- Node.js 16+ 
- npm or yarn package manager

### Setup Steps

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd robridge-ui
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm start
   ```

4. **Open in browser**
   Navigate to `http://localhost:3000`

### Build for Production
```bash
npm run build
```

## 🔧 Configuration

### Database Connection
Configure PostgreSQL connection in Settings > Database:
- Host: Database server address
- Port: Database port (default: 5432)
- Database: Database name
- Username: Database user
- Password: Database password

### Scanner Settings
Configure barcode scanner in Settings > Scanner:
- Device Type: Camera, USB, or Bluetooth
- Resolution: Camera resolution settings
- Frame Rate: Video capture frame rate
- Auto Focus: Enable/disable auto focus
- Flash: Enable/disable camera flash

## 📱 Responsive Design

The application is fully responsive and optimized for:
- **Desktop**: Full-featured interface with side-by-side layouts
- **Tablet**: Adaptive layouts with touch-friendly controls
- **Mobile**: Mobile-first design with optimized navigation

## 🔒 Security Features

- **Input Validation**: Comprehensive form validation
- **Secure Storage**: Encrypted password fields
- **Access Control**: Role-based user permissions
- **Connection Security**: Secure database connections

## 🚀 Performance Features

- **Lazy Loading**: Components load on demand
- **Optimized Rendering**: Efficient React rendering
- **Image Optimization**: Compressed image processing
- **Caching**: Smart data caching strategies

## 🧪 Testing

### Run Tests
```bash
npm test
```

### Test Coverage
```bash
npm run test -- --coverage
```

## 📁 Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── Navigation.js   # Main navigation sidebar
│   └── Navigation.css
├── pages/              # Main application pages
│   ├── Dashboard.js    # Dashboard overview
│   ├── BarcodeScanner.js # Barcode scanning interface
│   ├── BarcodeGenerator.js # Barcode generation interface
│   ├── ImageProcessing.js # Image processing interface
│   ├── RobotControl.js # Robot control console
│   ├── Settings.js     # Settings and configuration
│   └── *.css          # Page-specific styles
├── App.js              # Main application component
├── App.css             # Application-level styles
├── index.js            # Application entry point
└── index.css           # Global styles
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Contact the development team
- Check the documentation

## 🔮 Roadmap

### Upcoming Features
- **Advanced Analytics**: Enhanced reporting and data visualization
- **Multi-language Support**: Internationalization (i18n)
- **Dark Theme**: Alternative color scheme
- **Mobile App**: React Native companion app
- **API Integration**: RESTful API endpoints
- **Real-time Collaboration**: Multi-user support

### Performance Improvements
- **Web Workers**: Background processing for heavy operations
- **Service Workers**: Offline functionality and caching
- **Code Splitting**: Dynamic imports for better performance
- **Bundle Optimization**: Reduced bundle size

---

**RobBridge UI** - Empowering robot control and barcode management with modern web technology.
