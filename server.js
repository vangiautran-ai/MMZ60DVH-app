const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'DVTP')));

const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Lỗi kết nối SQLite:', err);
    else console.log('Đã kết nối Cơ sở dữ liệu SQLite MemoryZone.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ho_ten TEXT NOT NULL,
        sdt TEXT NOT NULL,
        loai_thiet_bi TEXT NOT NULL,
        ngay_hen TEXT NOT NULL,
        khung_gio TEXT NOT NULL,
        slots_json TEXT,
        ghi_chu TEXT,
        trang_thai TEXT DEFAULT 'Chờ tiếp nhận',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tự động bổ sung cột slots_json nếu CSDL cũ chưa có
    db.run(`ALTER TABLE bookings ADD COLUMN slots_json TEXT`, (err) => {});
});

const ALL_SLOTS = [
    "10:00 - 10:30",
    "10:30 - 11:00",
    "11:00 - 11:30",
    "11:30 - 12:00",
    "12:00 - 12:30",
    "12:30 - 13:00"
];

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'DVTP', 'index.html')));
app.get('/dat-lich', (req, res) => res.sendFile(path.join(__dirname, 'DVTP', 'index.html')));
app.get('/quan-ly-ky-thuat', (req, res) => res.sendFile(path.join(__dirname, 'DVTP', 'admin.html')));

// API 1: Lấy danh sách các slot đã bị chiếm (Bỏ qua đơn Đã hủy)
app.get('/api/booked-slots', (req, res) => {
    const { ngay } = req.query;
    if (!ngay) return res.json({ success: true, bookedSlots: [], isFullDay: false });

    db.all(`SELECT khung_gio, slots_json FROM bookings WHERE ngay_hen = ? AND trang_thai != 'Đã hủy'`, [ngay], (err, rows) => {
        if (err) return res.status(500).json({ success: false, bookedSlots: [] });

        let bookedSlots = [];
        rows.forEach(row => {
            if (row.slots_json) {
                try {
                    const parsed = JSON.parse(row.slots_json);
                    if (Array.isArray(parsed)) bookedSlots = bookedSlots.concat(parsed);
                } catch (e) {}
            } else if (row.khung_gio) {
                // Tương thích với dữ liệu chuỗi cũ
                if (row.khung_gio.includes("10h00 - 11h00")) bookedSlots.push("10:00 - 10:30", "10:30 - 11:00");
                else if (row.khung_gio.includes("11h00 - 12h00")) bookedSlots.push("11:00 - 11:30", "11:30 - 12:00");
                else if (row.khung_gio.includes("12h00 - 13h00")) bookedSlots.push("12:00 - 12:30", "12:30 - 13:00");
                else bookedSlots.push(row.khung_gio);
            }
        });

        const uniqueBooked = [...new Set(bookedSlots)];
        const isFullDay = uniqueBooked.length >= 6;

        res.json({
            success: true,
            bookedSlots: uniqueBooked,
            totalBookedCount: uniqueBooked.length,
            isFullDay
        });
    });
});

// API 2: Đặt lịch mới
app.post('/api/booking', (req, res) => {
    const { ho_ten, sdt, loai_thiet_bi, ngay_hen, khung_gio, ghi_chu } = req.body;

    if (!ho_ten || !sdt || !loai_thiet_bi || !ngay_hen || !khung_gio) {
        return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ thông tin!' });
    }

    const slotIndex = ALL_SLOTS.indexOf(khung_gio);
    if (slotIndex === -1) {
        return res.status(400).json({ success: false, message: 'Khung giờ chọn không hợp lệ!' });
    }

    let requiredSlots = [];
    if (loai_thiet_bi === 'Laptop') {
        requiredSlots = [ALL_SLOTS[slotIndex]];
    } else if (loai_thiet_bi === 'PC') {
        if (slotIndex >= ALL_SLOTS.length - 1) {
            return res.status(400).json({ success: false, message: 'Vệ sinh PC cần 60 phút (2 khung giờ). Vui lòng chọn khung giờ từ 10:00 đến 12:00!' });
        }
        requiredSlots = [ALL_SLOTS[slotIndex], ALL_SLOTS[slotIndex + 1]];
    }

    db.all(`SELECT khung_gio, slots_json FROM bookings WHERE ngay_hen = ? AND trang_thai != 'Đã hủy'`, [ngay_hen], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi máy chủ!' });

        let existingSlots = [];
        rows.forEach(row => {
            if (row.slots_json) {
                try { existingSlots = existingSlots.concat(JSON.parse(row.slots_json)); } catch(e){}
            } else if (row.khung_gio) {
                if (row.khung_gio.includes("10h00 - 11h00")) existingSlots.push("10:00 - 10:30", "10:30 - 11:00");
                else if (row.khung_gio.includes("11h00 - 12h00")) existingSlots.push("11:00 - 11:30", "11:30 - 12:00");
                else if (row.khung_gio.includes("12h00 - 13h00")) existingSlots.push("12:00 - 12:30", "12:30 - 13:00");
                else existingSlots.push(row.khung_gio);
            }
        });

        const isConflict = requiredSlots.some(s => existingSlots.includes(s));
        if (isConflict) {
            return res.status(400).json({ success: false, message: `Khung giờ bạn chọn đã có khách đặt. Vui lòng chọn khung giờ khác!` });
        }

        const displayTime = requiredSlots.length > 1 ? `${requiredSlots[0].split(' - ')[0]} - ${requiredSlots[1].split(' - ')[1]}` : requiredSlots[0];
        const slotsJsonStr = JSON.stringify(requiredSlots);

        const query = `INSERT INTO bookings (ho_ten, sdt, loai_thiet_bi, ngay_hen, khung_gio, slots_json, ghi_chu) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        db.run(query, [ho_ten, sdt, loai_thiet_bi, ngay_hen, displayTime, slotsJsonStr, ghi_chu], function (err) {
            if (err) return res.status(500).json({ success: false, message: 'Không thể ghi nhận thông tin đặt lịch!' });
            res.json({ success: true, message: 'Đặt lịch thành công!', booking_id: this.lastID });
        });
    });
});

// API 3: Lấy danh sách đơn (Hỗ trợ Lọc theo Ngày & Trạng thái)
app.get('/api/admin/bookings', (req, res) => {
    const { ngay, trang_thai } = req.query;
    let query = `SELECT * FROM bookings WHERE 1=1`;
    let params = [];

    if (ngay) {
        query += ` AND ngay_hen = ?`;
        params.push(ngay);
    }
    if (trang_thai) {
        query += ` AND trang_thai = ?`;
        params.push(trang_thai);
    }

    query += ` ORDER BY ngay_hen DESC, id DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi truy xuất dữ liệu' });
        res.json({ success: true, data: rows });
    });
});

// API 4: Cập nhật trạng thái
app.put('/api/admin/bookings/:id', (req, res) => {
    const { trang_thai } = req.body;
    const { id } = req.params;

    db.run(`UPDATE bookings SET trang_thai = ? WHERE id = ?`, [trang_thai, id], function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi cập nhật' });
        res.json({ success: true, message: 'Cập nhật trạng thái thành công!' });
    });
});

// API 5: Xóa đơn đặt lịch
app.delete('/api/admin/bookings/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM bookings WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Lỗi khi xóa đơn!' });
        res.json({ success: true, message: 'Xóa đơn thành công!' });
    });
});

// API 6: Sheet thống kê
app.get('/api/admin/summary-stats', (req, res) => {
    const query = `SELECT * FROM bookings`;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, data: [] });

        const summaryMap = {};
        rows.forEach(r => {
            if (!summaryMap[r.ngay_hen]) {
                summaryMap[r.ngay_hen] = {
                    ngay_hen: r.ngay_hen,
                    tong_don: 0,
                    cho_tiep_nhan: 0,
                    da_nhan_may: 0,
                    dang_ve_sinh: 0,
                    hoan_thanh: 0,
                    da_huy: 0,
                    used_slots_count: 0
                };
            }

            const item = summaryMap[r.ngay_hen];
            item.tong_don += 1;
            if (r.trang_thai === 'Chờ tiếp nhận') item.cho_tiep_nhan += 1;
            if (r.trang_thai === 'Đã nhận máy') item.da_nhan_may += 1;
            if (r.trang_thai === 'Đang vệ sinh') item.dang_ve_sinh += 1;
            if (r.trang_thai === 'Hoàn thành') item.hoan_thanh += 1;
            if (r.trang_thai === 'Đã hủy') item.da_huy += 1;

            if (r.trang_thai !== 'Đã hủy') {
                if (r.slots_json) {
                    try { item.used_slots_count += JSON.parse(r.slots_json).length; } catch(e){}
                } else {
                    item.used_slots_count += (r.loai_thiet_bi === 'PC' ? 2 : 1);
                }
            }
        });

        res.json({ success: true, data: Object.values(summaryMap) });
    });
});

app.listen(PORT, () => console.log(`=== SERVER RUNNING AT PORT ${PORT} ===`));