# Hybrid App(Flutter + Web App) 開發指南

## 目錄

- [介紹](#介紹)
- [套件選擇](#套件選擇)
  - [webview_flutter](#webview_flutter)
- [Flutter 與 Web App 的溝通方式](#flutter-與-web-app-的溝通方式)
  - [初始化通道與 callback 函數](#初始化通道與callback函數)
  - [Flutter → Web App](#flutter--web-app)
  - [Web App → Flutter](#web-app--flutter)
- [資料的同步化](#資料的同步化)
  - [同步化流程](#同步化流程)
  - [常見的資料同步方法](#常見的資料同步方法)
    - [1. URL 傳遞](#1-url-傳遞)
    - [2. Cookie 儲存](#2-cookie-儲存)
    - [3. LocalStorage 儲存](#3-localstorage-儲存)
- [性能優化](#性能優化)
  - [flutter 中開兩次 webview(較簡單)](#flutter中開兩次webview較簡單)
  - [flutter 中啟動 local server](#flutter中啟動local-server)
- [參考資料](#參考資料)

## 介紹

當公司內部 app team 人力資源有限時，一種常見做法是採用**混合式架構**。也就是在原生應用中，透過 **WebView**嵌入網頁應用程式。這種方式能夠將工作劃分為：部分功能由 app team 開發，其他部分則以網頁技術實作。

**重要注意事項：** 為了通過平台審核或應用商店的規範，混合式應用通常需要保留一定比例的原生程式碼。一個常見的模式是將登入、註冊或導覽等關鍵入口以原生方式實作，而應用的主要功能則透過嵌入的網頁實現。

## 套件選擇

### webview_flutter

- 由官方提供的套件
- 另外也有社群提供的 `flutter_inappwebview`
- **我們 app 團隊選用此套件**

## Flutter 與 Web App 的溝通方式

### 初始化通道與 callback 函數

在 Flutter 中使用 `javascriptChannel` 來建立通訊通道

```dart
// 在flutter中初始化創建通道
WebView(
  javascriptMode: JavascriptMode.unrestricted,
  javascriptChannels: <JavascriptChannel>[
    JavascriptChannel(
      name: 'nativeChannel', // 註冊供 Web 調用的通道名稱
      onMessageReceived: (JavascriptMessage msg) async {
        jsonDecode(msg.message)
      },
    ),
  ].toSet(),
)
```

```javascript
// 在web app中註冊供flutter層調用的callback函數
window['javascriptChannel'] = function (jsonStr) {
    ...
}

```

#### Flutter → Web App

呼叫 JavaScript 在 window 物件上定義好的函數

```dart
// Flutter 層取得資料後傳遞給 Web App
final userData = await fetchUserData(); // 從 API 取得使用者資料
final data = {
  'token': userData['accessToken'],
  'userInfo': userData['userInfo']
};
await _webViewController?.evaluateJavascript('window.javascriptChannel(JSON.stringify(data))');
```

#### Web App → Flutter

呼叫 Flutter 定義的通道上的 `postMessage` 方法

```javascript
// 在 Web App 中向 Flutter 發送訊息
const message = {
  type: 'test',
  data: null,
};
window['nativeChannel'].postMessage(JSON.stringify(message));
```

## 資料的同步化

在 hybrid app 中，我們會在 Flutter 層向後端 API 送出登入請求，取得使用者相關資料和 accessToken，並將此資料同步給由 webview 載入的 web app。

### 同步化流程

1. **Flutter 層**：處理登入邏輯，取得使用者資料和 token
2. **資料傳遞**：將資料透過選定的方法傳遞給 Web App
3. **Web App 層**：接收並儲存資料，用於後續 API 請求

### 常見的資料同步方法：

#### 1. URL 傳遞

- **原理：** 將資料寫入 URL 參數，再透過 webview 載入 web app
- **優點：** Web app 可以在任何階段取得此資料
- **缺點：** 安全性較低，且 URL 有字元長度限制(約 2000)

```dart
// Flutter 端實作
String buildUrlWithData(String baseUrl, Map<String, dynamic> userData) {
  final uri = Uri.parse(baseUrl);
  final queryParams = {
    'token': userData['accessToken'],
    'userId': userData['userId'],
    'userInfo': jsonEncode(userData['userInfo']),
  };
  return uri.replace(queryParameters: queryParams).toString();
}

// 載入 Web App
WebView(
  initialUrl: buildUrlWithData('https://yourapp.com', userData),
  // ... 其他配置
)
```

```javascript
// Web App 端實作
function getDataFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return {
    token: urlParams.get('token'),
    userId: urlParams.get('userId'),
    userInfo: JSON.parse(urlParams.get('userInfo') || '{}'),
  };
}
```

#### 2. Cookie 儲存

- **使用情況：** 較多人採用此方法
- **優點：** 安全性較高，支援跨域設定
- **缺點：** 需要處理 Cookie 的設定和讀取

#### 3. LocalStorage 儲存

- **目前狀況：** 尚未成功
- **問題原因：**
  - localStorage 具有 origin 限制，只能在對應的域名下進行寫入操作, 因此資料寫入必須等到 webview 完全載入目標 URL 後才能執行
  - `webview_flutter` 僅提供 `onPageFinished` 回調函數來處理頁面載入完成事件, 該回調的觸發時機相當於瀏覽器的 `onLoad` 事件 ([資料來源](https://zhuanlan.zhihu.com/p/337825740))
  - 由於 SPA 架構的特性，此時應用程式通常已經完成初始化，導致 web app 無法在啟動階段即時取得同步資料，造成資料同步時機的延遲問題

```dart
// Flutter 端嘗試寫入 LocalStorage (目前有問題)
WebView(
  onPageFinished: (String url) async {
    // 此時 SPA 可能已經初始化完成，無法及時同步資料
    await _webViewController?.evaluateJavascript('''
      localStorage.setItem('accessToken', '${userData['accessToken']}');
      localStorage.setItem('userInfo', '${jsonEncode(userData['userInfo'])}');
    ''');
  },
)
```

## 性能優化

### flutter 中開兩次 webview(較簡單)

**核心概念：** 在應用程式啟動時預先載入目標網站的靜態資源，將下載時間隱藏在啟動動畫期間，提升使用者體驗。

#### 實施流程

1. **App 啟動階段**

   - 顯示啟動動畫/載入畫面
   - 同時在背景開啟 WebView 載入目標 URL
   - 自動下載並緩存所有靜態檔案（HTML、CSS、JavaScript
   - 等待檔案下載完才進入下個階段

2. **登入後階段**
   - 使用者完成登入驗證
   - 直接從本地緩存載入已下載的靜態資源
   - 減少白畫面(SPA)時間

### flutter 中啟動 local server

**核心概念：** 在 Flutter 應用中啟動本地 HTTP 服務器，預先下載並緩存 Web 應用的所有靜態資源，通過 URL 攔截路徑切換實現快速載入。

#### 實施流程

1. **資源預載入階段**

   - 在 Flutter 應用啟動時，下載目標網站的完整靜態資源
   - 將所有檔案（HTML、CSS、JS、圖片等）存儲到本地
   - 啟動本地 HTTP 服務器（如 localhost:8080）

2. **導航攔截階段**

   - 使用 WebView 的 NavigationDelegate 攔截所有導航請求
   - 檢查請求路徑是否在緩存頁面列表中
   - 將匹配的請求重定向到本地服務器

3. **本地服務階段**
   - 本地服務器直接提供預緩存的靜態檔案
   - 消除網絡延遲，實現即時載入
   - 保持與原始 Web 應用相同的功能

## 參考資料

- [Flutter WebView 與 H5 的通信方式](https://juejin.cn/post/7201892702181851197)
- [Flutter WebView 性能优化，让 h5 像原生页面一样优秀](https://juejin.cn/post/7199298121792749628)
- [Flutter WebView 通信相關討論](https://bbs.itying.com/topic/685412e74715aa00884817f7)
- [Flutter WebView 開發實踐](https://juejin.cn/post/7156901434489831461#heading-6)
- [Android WebView onPageFinished 对于 Document 意味着什么](https://zhuanlan.zhihu.com/p/337825740)
