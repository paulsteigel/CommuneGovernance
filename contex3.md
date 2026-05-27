Context đầy đủ — CommuneGovernance (26/05/2026)
Hạ tầng

API: https://careapi-cx7avsd4pa-as.a.run.app
Firebase project: communegovernance — account ngocdd@thiennhienviet.org.vn
Backend: F:\Developers\CARE\CommuneGovernance\ — Node 24, Firebase Functions v2, Cloud Run asia-southeast1
App: F:\Developers\CARE\CommuneGovernance\app\ — Expo SDK 56, EAS Build, project @paulsteigel/commune-governance
Build: EAS cloud build (Expo Go không dùng được vì có native module @react-native-community/netinfo)
Test users (xa: XATEST, password: Test@1234): USR_THON01 (CB_THON), USR_CBCM01 (CB_CHUYEN_MON), USR_LANHDAO (LANH_DAO)


Những gì đã làm hôm nay
Backend — đã deploy lên Cloud Run ✅
utils/manifest.js — toàn bộ file đã rewrite, gồm:

BUG-B1: rebuildManifest() — normalize chi_so_ids và danh_sach_thon từ string thành array qua helper _toArray()
BUG-B2: buildManifest() — CB_CM nhận thêm pending_verifications[] (submissions lọc theo linh_vuc_codes)
FEAT-2: buildManifest() — LANH_DAO/ADMIN nhận pending_verifications[] toàn bộ (không lọc linh_vuc)
BUG-A1 support: year param optional — nếu null thì auto-detect từ fullManifest.year
Helper _mapSub() dùng chung cho CB_CM và LANH_DAO
pending_verifications item gồm: submission_id, req_id, thon_code, status, submitted_by, submitted_at, values, tieu_de, deadline

handlers/auth.js — login rewrite:

Chỉ require user_id + password (bỏ xa_code, year bắt buộc)
xa_code lấy từ user.xa_code trong Firestore (trusted source)
year = null → buildManifest tự detect
Backward compatible: body cũ có xa_code/year vẫn OK (ignored)
Test curl đã pass: ho_ten, xa_code, current_year, pending_verifications đều đúng ✅

App — code xong, chưa build, chưa test
app/(auth)/login.jsx — BUG-A1 + BUG-A2:

Form chỉ còn 2 field: user_id + password
Gọi login({ user_id, password }) — không gửi xa_code/year
Sau login: xa_code ← manifest.user.xa_code, year ← manifest.config.current_year
Lưu ho_ten (không phải ten)

app/(lanh-dao)/index.jsx — FEAT-2, rewrite hoàn toàn:

Dùng SectionList với 2 sections:

Section 1 "Tiến độ": data từ getDashboard — progress bar, stats (giữ nguyên logic cũ)
Section 2 "Cần xử lý": data từ manifest.pending_verifications — sorted theo priority (PENDING_VERIFY → IN_REVIEW → NEEDS_REVISION → VERIFIED), overdue lên đầu trong cùng status


Mỗi submission card có 2 nút: Nhắc nhở (Alert mock) + Xét duyệt (navigate sang verify screen)
onRefresh: gọi đồng thời getDashboard + pullManifest

app/(lanh-dao)/verify/[subId].jsx — FEAT-2, tạo mới:

Tìm submission từ manifest.pending_verifications theo subId
Hiển thị: thông tin submission, values (dùng indicatorMap keyed by chi_so_id)
2 quyết định: Xác nhận ✓ / Yêu cầu sửa (batch mode only, đơn giản hơn CB_CM)
Gọi verifyData({ verify_mode: "batch", decision }) — backend tự log role
Không có warning popup (chỉ log backend để thống kê bypass về sau)

app/(lanh-dao)/_layout.jsx — update:

Thêm Stack.Screen name="verify/[subId]" với headerShown: true


Vấn đề tồn đọng
Build app: EAS đang queue lúc cuối buổi, chưa biết kết quả. Cụ cần:

Vào https://expo.dev kiểm tra build status
Nếu failed → chạy lại eas build --platform android --profile preview
4 file app chưa được copy vào project — cụ cần copy thủ công (tôi chưa gửi được file download do hết quota)

Lỗi nhỏ trong CB_CM verify ((cb-cm)/verify/[subId].jsx): indicatorMap đang dùng ind.id thay vì ind.chi_so_id → indicator name hiện undefined. File LANH_DAO verify đã fix đúng. CB_CM verify chưa fix.

Thứ tự việc tiếp theo
#ViệcGhi chú1Gửi lại 4 file app dạng downloadCụ yêu cầu đầu session sau2Fix BUG trong CB_CM verifyind.id → ind.chi_so_id3EAS build + testKiểm tra login, LANH_DAO verify4FEAT-1: CB_CM tạo request — UI appBackend createRequest đã có5FEAT-3: Settings / chọn năm báo cáo6FEAT-4: Admin tạo user — backend trướcEndpoint mới POST /create_user7FEAT-5: Voice (Azure Speech)Để sau cùng

Workflow deploy
bash# Backend
cd F:\Developers\CARE\CommuneGovernance
npx firebase use communegovernance --account ngocdd@thiennhienviet.org.vn
npx firebase deploy --only functions

# App build
cd F:\Developers\CARE\CommuneGovernance\app
$env:PATH += ";C:\Users\Administrator\AppData\Roaming\npm"
eas build --platform android --profile preview

# Test login
Invoke-RestMethod -Uri "https://careapi-cx7avsd4pa-as.a.run.app/login" -Method POST -ContentType "application/json" -Body '{"user_id":"USR_LANHDAO","password":"Test@1234"}' | ConvertTo-Json -Depth 5