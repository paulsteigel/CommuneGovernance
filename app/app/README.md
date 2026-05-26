# CommuneGovernance — Mobile App

React Native / Expo app cho cán bộ xã, thôn vùng dân tộc thiểu số.

## Yêu cầu hệ thống

- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- EAS CLI (để build APK): `npm install -g eas-cli`

## Setup lần đầu

```bash
# 1. Vào thư mục app
cd app

# 2. Cài dependencies
npm install

# 3. Chạy dev server
npx expo start

# Scan QR bằng Expo Go trên điện thoại Android để test nhanh
```

## Build APK (Android)

```bash
# Đăng nhập EAS (chỉ cần 1 lần)
eas login

# Tạo file eas.json nếu chưa có
eas build:configure

# Build APK preview (không cần Google Play)
eas build --platform android --profile preview
```

Thêm vào `eas.json`:
```json
{
  "build": {
    "preview": {
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

## Cấu trúc thư mục

```
app/
├── app/
│   ├── _layout.jsx           Root layout — auth guard + role redirect
│   ├── (auth)/
│   │   └── login.jsx         Màn hình đăng nhập
│   ├── (cb-thon)/
│   │   ├── index.jsx         Danh sách requests được giao
│   │   └── submit/[reqId]    Form nhập số liệu
│   ├── (cb-cm)/
│   │   ├── index.jsx         Submissions cần xét duyệt
│   │   └── verify/[subId]    Màn xét duyệt
│   └── (lanh-dao)/
│       └── index.jsx         Dashboard tổng quan
├── components/               Shared components
├── services/api.js           Wrapper gọi backend API
├── store/authStore.js        Auth state (Zustand + SecureStore)
└── constants/                Theme, config
```

## Test users

| user_id        | vai_tro       | password   | xa_code |
|----------------|---------------|------------|---------|
| USR_THON01     | CB_THON       | Test@1234  | XATEST  |
| USR_CBCM01     | CB_CHUYEN_MON | Test@1234  | XATEST  |
| USR_LANHDAO    | LANH_DAO      | Test@1234  | XATEST  |

## API Backend

```
https://careapi-cx7avsd4pa-as.a.run.app
```

## Tính năng offline

- Submissions được lưu vào AsyncStorage khi không có mạng
- Hiển thị banner "Không có mạng" ở đầu màn hình
- Số lượng bản ghi chờ gửi hiển thị trong header CB_THON
- TODO: Background sync tự động khi có mạng trở lại
