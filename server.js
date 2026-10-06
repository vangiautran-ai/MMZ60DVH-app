const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Cấu hình thư mục chứa giao diện tĩnh là DVTP
app.use(express.static(path.join(__dirname, 'DVTP')));

// Khởi tạo cơ sở dữ liệu SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Lỗi kết nối SQLite:', err);
    else console.log('Đã kết nối Cơ sở dữ liệu SQLite MemoryZone.');
});

// Tạo bảng lưu danh sách đặt lịch
db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ho_ten TEXT NOT NULL,
    sdt TEXT NOT NULL,
    loai_thiet_bi TEXT NOT NULL,
    ngay_hen TEXT NOT NULL,
    khung_gio TEXT NOT NULL,
    ghi_chu TEXT,
    trang_thai TEXT DEFAULT 'Chờ tiếp nhận',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// --- CÁC ĐƯỜNG DẪN TRANG WEB TRUY CẬP CHUYÊN NGHIỆP ---

// 1. Điều hướng Trang chủ hoặc /dat-lich -> Mở Form Khách hàng
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'DVTP', 'index.html'));
});

app.get('/dat-lich', (req, res) => {
    res.sendFile(path.join(__dirname, 'DVTP', 'index.html'));
});

// 2. Đường dẫn dành riêng cho Team Kỹ Thuật
app.get('/quan-ly-ky-thuat', (req, res) => {
    res.sendFile(path.join(__dirname, 'DVTP', 'admin.html'));
});


// --- CÁC API XỬ LÝ DỮ LIỆU ---

// API 1: Khách hàng gửi Form đăng ký
app.post('/api/booking', (req, res) => {
    const { ho_ten, sdt, loai_thiet_bi, ngay_hen, khung_gio, ghi_chu } = req.body;

    if (!ho_ten || !sdt || !loai_thiet_bi || !ngay_hen || !khung_gio) {
        return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ thông tin bắt buộc!' });
    }

    // Kiểm tra Thứ 7, Chủ Nhật
    const bookingDate = new Date(ngay_hen);
    const dayOfWeek = bookingDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return res.status(400).json({ 
            success: false, 
            message: 'Chương trình Giờ Vàng chỉ áp dụng từ Thứ 2 đến Thứ 6!' 
        });
    }

    // Kiểm tra giới hạn 5 máy/ngày
    db.get('SELECT COUNT(*) as count FROM bookings WHERE ngay_hen = ?', [ngay_hen], (err, row) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Lỗi hệ thống máy chủ!' });
        }

        if (row.count >= 5) {
            return res.status(400).json({ 
                success: false, 
                message: `Ngày ${ngay_hen} đã nhận đủ 05 suất ưu đãi. Vui lòng chọn ngày khác!` 
            });
        }

        const query = `INSERT INTO bookings (ho_ten, sdt, loai_thiet_bi, ngay_hen, khung_gio, ghi_chu) VALUES (?, ?, ?, ?, ?, ?)`;
        db.run(query, [ho_ten, sdt, loai_thiet_bi, ngay_hen, khung_gio, ghi_chu], function (err) {
            if (err) {
                return res.status(500).json({ success: false, message: 'Không thể ghi nhận thông tin!' });
            }
            res.json({
                success: true,
                message: 'Đặt lịch thành công!',
                booking_id: this.lastID
            });
        });
    });
});

// API 2: Lấy danh sách cho Kỹ thuật viên
app.get('/api/admin/bookings', (req, res) => {
    const { ngay } = req.query;
    let query = `SELECT * FROM bookings ORDER BY ngay_hen DESC, khung_gio ASC`;
    let params = [];

    if (ngay) {
        query = `SELECT * FROM bookings WHERE ngay_hen = ? ORDER BY khung_gio ASC`;
        params = [ngay];
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi truy xuất dữ liệu' });
        res.json({ success: true, data: rows });
    });
});

// API 3: Cập nhật trạng thái xử lý máy
app.put('/api/admin/bookings/:id', (req, res) => {
    const { trang_thai } = req.body;
    const { id } = req.params;

    db.run(`UPDATE bookings SET trang_thai = ? WHERE id = ?`, [trang_thai, id], function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi cập nhật' });
        res.json({ success: true, message: 'Đã cập nhật trạng thái thành công!' });
    });
});

app.listen(PORT, () => {
    console.log(`=== MEMORYZONE HÀ NỘI SYSTEM ===`);
    console.log(`1. Trang Đặt Lịch Khách Hàng: http://localhost:${PORT}/dat-lich`);
    console.log(`2. Trang Quản Lý Kỹ Thuật : http://localhost:${PORT}/quan-ly-ky-thuat`);
});