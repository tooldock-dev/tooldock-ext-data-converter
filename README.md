# 🔁 資料轉換工具

ToolDock 擴充：開發與文書工作常用的 27 種轉換，輸入後即時轉換。

ToolDock 1.4.0 以上可以從擴充商店安裝。這個擴充原本內建在 ToolDock 裡，為了讓平台更精簡、擴充可以獨立發版，改由商店提供，**這個 repo 是唯一的原始碼**。從內建版本改裝商店版本時，原本的資料與設定都會保留（兩者的擴充 id 相同）。

## 功能

- **JSON**：格式化、壓縮、JSON ⇄ YAML、JSON ⇄ CSV
- **編碼**：Base64、URL、HTML 實體、Unicode 跳脫、Hex
- **時間**：Unix 時間戳 ⇄ 日期時間、民國 ⇄ 西元
- **雜湊**：MD5、SHA-1／256／512、HMAC
- **其他**：UUID、JWT 解析、命名風格（camelCase、snake_case…）、全形 ⇄ 半形、行排序與去重
- **讀寫檔案**：從檔案載入輸入、把結果另存（單檔 10 MB 以內）

## 資料交換

| 格式 | 說明 |
|---|---|
| `tooldock.text` | 接收其他工具分享的文字（`text/*`、`application/json`），放進輸入區並自動切到對應的轉換器 |
| `tooldock.table` | 接收表格，轉成 CSV 放進輸入區，切到「CSV → JSON」 |

## 設定

| 設定 | 預設 | 說明 |
|---|---|---|
| `dataConverter.indent` | `2` | JSON／YAML 格式化時使用的空白數 |
| `dataConverter.liveConvert` | `true` | 輸入內容時自動轉換；關閉後需手動按「轉換」 |

## 測試

```bash
npm test
```

測試 JSON ⇄ YAML、民國 ⇄ 西元、所有轉換器的範例輸入、縮排設定即時生效，以及接收 `tooldock.text`／`tooldock.table`（mime 檢查、CSV 跳脫、欄位數不符時拒絕）。測試用 `test/mock-ctx.js` 模擬平台的 `ctx`，不需要啟動 ToolDock。

## 開發

需要先安裝 ToolDock 和 Node.js 18 以上。

| 指令 | 說明 |
|---|---|
| `npm run dev` | 以開發模式啟動 ToolDock 並載入這個擴充。存檔後會自動重新載入後端和畫面 |
| `npm run debug` | 同上，並開啟後端偵錯埠 `127.0.0.1:9229` |
| `npm run validate` | 檢查 manifest、檔案和相依套件 |
| `npm run pack` | 打包成 `dist/data-converter-<版本>.tbx`，只含正式相依 |
| `npm run install-local` | 打包並安裝到本機的 ToolDock |

開發模式使用獨立的資料目錄（`ToolDock-ExtDev`），可以和平常使用的 ToolDock 同時開啟。

## 發佈

推送 `v*` tag 後，GitHub Actions（`.github/workflows/release.yml`）會自動驗證、執行測試、打包、簽章，並建立 GitHub Release。ToolDock 商店會從 Release 下載並驗證簽章。

```bash
npm version patch        # 或 minor / major；會更新 package.json 並建立 v<版本> tag
git push --follow-tags
```

需要的設定（repo → Settings → Secrets and variables → Actions）：

| 種類 | 名稱 | 內容 |
|---|---|---|
| Secret | `TOOLDOCK_SIGNING_KEY` | ToolDock 發佈金鑰的私鑰（PEM 檔完整內容） |
| Variable | `TOOLDOCK_PUBLIC_KEY` | 公鑰字串，CI 發佈前會再驗證一次 |

Release 會附上 `data-converter-<版本>.tbx`、`.tbx.sha256`、`.tbx.sig`。詳見 ToolDock 的 [docs/RELEASE.md](https://github.com/tooldock-dev/tooldock-releases/blob/main/docs/RELEASE.md)。

## 專案結構

```
backend/
  index.js       啟用、畫面呼叫的方法、資料交換接收端
  converters.js  所有轉換器（id、選項、範例、轉換函式）
  csv.js         CSV 解析與輸出
ui/
  index.html     畫面
  app.js         轉換器清單、輸入輸出、即時轉換
test/
```

## 授權

使用的 js-yaml 採 MIT 授權，授權條款隨套件附在 `node_modules/js-yaml/LICENSE`。
