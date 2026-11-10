# 保險書面分析報告填寫工具 v1.1：Vercel 部署包

本專案已整理為可部署至 Vercel 的靜態網站，保留原本 113.12 版壽險、產險 PDF，新增你提供的「書面.pdf」115.10 版書面分析報告暨客戶風險辨識表。已包含各表欄位定位、中文字型、預覽圖片及 PDF 匯出程式。無須建置、安裝專案套件、設定 API 金鑰或資料庫。

| 可選範本 | 版本 | 文字欄位 | 勾選框 | 合計 |
| --- | --- | ---: | ---: | ---: |
| 新版合併報告／客戶風險辨識表 | 115.10 | 50 | 69 | 119 |
| 壽險分析報告 | 113.12 | 37 | 67 | 104 |
| 產險分析報告 | 113.12 | 42 | 45 | 87 |

初次開啟預設選擇新版合併報告。三份表單有各自的資料、定位與輸出設定；新版風險辨識的四列答案可選「是／否」，風險等級可選「一般／高」，由使用者自行確認。

本次交付已完成三份範本的 PDF 匯出、版面檢查、版本相容與資料帶入的程式檢查。本次環境無法完成實際瀏覽器操作測試，請在部署完成後依本文第七節確認。尚未登入你的 Vercel 帳號建立正式部署。

## 已經部署舊版的人

1. 先在原網站「草稿與設定」下載草稿 JSON 與定位 JSON 作備份。
2. 將本包的 `public` 整個資料夾、`templates`、`scripts`、`vercel.json` 與本說明覆蓋到原 GitHub 儲存庫中對應位置，再提交更新。Vercel 專案仍使用原設定，Output Directory 為 `public`。
3. 依你的專案部署流程更新正式網站。若採 CLI，請在原本連結該 Vercel 專案的資料夾更新檔案後執行部署，保留當地既有的 `.vercel` 專案連結。
4. 開啟更新後的網址，確認出現新版合併報告、壽險分析報告與產險分析報告三個頁籤。若仍顯示舊畫面，請重新整理快取。
5. 舊版 v1 草稿與定位 JSON 可直接匯入；只會套用檔案內原有的壽險／產險，不會清除新版合併報告的資料或定位。新輸出的 v2 草稿包含三份範本，請用此更新版匯入。

## 一、使用 GitHub 與 Vercel 網頁部署

這個方式方便日後更新程式，不需要在電腦安裝 Node.js。

1. 解壓縮本 ZIP，開啟 `insurance-report-vercel` 資料夾。
2. 登入 GitHub，建立一個儲存庫，例如 `insurance-report-vercel`。
3. 上傳這個資料夾裡面的檔案與 `public` 資料夾，再提交儲存。儲存庫最外層應同時看得到 `vercel.json` 與 `public`，而且首頁位置應為 `public/index.html`。請上傳解壓後的內容，不要只上傳 ZIP。
4. 登入 [Vercel](https://vercel.com/)，新增專案（Add New → Project），匯入這個 GitHub 儲存庫。
5. 依下表核對設定，再按 Deploy。`vercel.json` 已提供對應設定。
6. 部署完成後，開啟 Vercel 顯示的網站網址，開始填寫報告。

| 設定 | 本專案的值 |
| --- | --- |
| Framework Preset | `Other` |
| Root Directory | `./`，也就是含有 `vercel.json` 的資料夾 |
| Build Command | 留空／略過 |
| Install Command | 留空／略過 |
| Output Directory | `public` |
| Environment Variables | 不需要 |

如果你把整個 `insurance-report-vercel` 資料夾上傳到儲存庫內層，請將 Root Directory 改選該資料夾。不要把 `public` 設為 Root Directory；它是 Output Directory。

Vercel 的靜態專案可使用 Other 並略過建置，且只公開輸出資料夾內的檔案。參考：[Configuring a Build](https://vercel.com/docs/builds/configure-a-build)、[vercel.json 設定](https://vercel.com/docs/project-configuration/vercel-json)。

## 二、不經 GitHub，使用 Vercel CLI 部署

此方式需要電腦已有 Node.js 與 npm。請在解壓後、含有 `vercel.json` 的資料夾開啟終端機，執行：

```sh
npx vercel@latest login
npx vercel@latest --prod
```

第一次使用時依提示登入你的 Vercel 帳號，選擇所屬帳號／團隊，並建立或連結專案。若詢問程式所在資料夾，選擇目前資料夾 `./`。專案名稱可使用 `insurance-report-vercel`；若需核對框架與輸出目錄，使用上方設定表。

完成後，終端機會顯示部署結果與網址。`--prod` 表示正式環境部署；請確認選擇的是你打算使用的 Vercel 專案。參考：[Deploying to Vercel](https://vercel.com/docs/deployments)、[Vercel deploy CLI](https://vercel.com/docs/cli/deploy)。

## 三、部署包內容

| 路徑 | 用途 |
| --- | --- |
| `vercel.json` | 靜態部署設定，略過套件安裝與建置 |
| `public/index.html` | 網站首頁 |
| `public/app.js` | 填寫、預覽、位置校正與草稿管理 |
| `public/engine.js` | 中文字型、文字縮放、勾選與 PDF 輸出 |
| `public/templates.js` | 三份報告的欄位與定位資料 |
| `templates/*.json` | 三份範本的可編輯設定來源 |
| `scripts/build_templates.py` | 將範本 JSON 編譯成瀏覽器使用的 templates.js |
| `scripts/build_portable.py` | 重新產生單檔離線版 |
| `public/style.css` | 介面樣式 |
| `public/assets/` | 原始 PDF、預覽圖片、中文字型、函式庫及授權聲明 |
| `public/portable.html` | 可下載至電腦、直接開啟的完整離線版 |

本次新增 `public/assets/unified.pdf` 與 `unified.png`，並更新範本切換、資料帶入、草稿格式、PDF 資源載入與離線版。原壽險／產險 PDF 與原有定位保留。請保留所有 `public/assets` 內容及 `THIRD-PARTY-NOTICES.txt`。

## 四、操作方式

1. 開啟網站，選擇「新版合併報告」、「壽險分析報告」或「產險分析報告」。
2. 在左側填寫資料，右側顯示原 PDF 版面與填寫預覽。
3. 需要微調時，開啟「位置校正」：可拖曳欄位、調整寬高、字級與勾勾大小，也可直接輸入座標。預設定位已包含在程式內。
4. 點「匯出 PDF」，完成後下載檔案。畫面也會保留「下載 PDF」與「開啟檢查」連結。
5. 若要下次續填，開啟「草稿與設定」→「下載草稿 JSON」。下次以「匯入草稿」載入。

新版合併報告共 119 個欄位，壽險共 104 個欄位，產險共 87 個欄位。文字放不下時會自動縮小；仍超出範圍或缺字時，會指出需要處理的欄位。需使用特殊姓名用字時，可在位置校正中載入支援該字的 TTF／OTF 字型。

日期請使用民國年；金額依原表標示單位輸入。簽名欄輸入的是打字文字，若須親簽／用印，可留白後列印辦理。列印完成的 PDF 時，請用 A4、實際大小／100%。

## 五、從原網址搬移資料

不同網站網址的瀏覽器儲存空間彼此獨立。既有草稿與你調整過的定位不會因為搬移程式而自動出現在新網址。

- **搬移填寫資料與定位：** 在原網址選「草稿與設定」→「下載草稿 JSON」，到 Vercel 新網址選「匯入草稿」。匯入草稿會取代檔案內所含範本的填寫內容與定位設定；未包含的範本會保留。
- **只搬移定位：** 在原網址選「下載定位 JSON」，到新網址選「匯入定位」。這個檔案不包含填寫資料。
- **在三份表單間帶入資料：** 在「草稿與設定」選擇「帶入基本資料的來源」，再按「將來源基本資料帶入本表」。新版合併的父母／子女、祖父母／孫子女選項，帶回舊版需要再細分，程式會提醒重新選擇。
- **有使用自訂字型：** JSON 不包含自訂字型檔，請在新網址重新載入同一個 TTF／OTF。

未啟用「在此瀏覽器記住填寫資料」時，關閉或重新整理頁面會失去尚未下載的草稿。JSON 可在不同電腦與網址之間轉移；此版本沒有帳號同步或多人共用資料庫。

## 六、網站存取與資料處理

程式在使用者的瀏覽器內處理填寫資料、生成 PDF；本版程式沒有將填寫內容送到伺服器的功能。網站會從 Vercel 載入程式、空白 PDF 範本、圖片與字型。

本專案本身沒有帳密登入功能。原 ChatGPT 網站的私人存取限制不會隨程式檔案搬移；Vercel 網站是否要求登入，請依你的專案存取設定確認。GitHub 儲存庫是否私人與部署網站是否需要登入，是不同的設定。

## 七、部署後快速確認與常見問題

- 開啟網站後，切換三份報告，確認原稿、版本與欄位正常顯示。新版是 115.10 版，原兩份是 113.12 版。
- 使用範例或測試資料匯出三份 PDF，檢查中文字、勾選與位置。
- 在新版「風險辨識」選擇答案，確認右側答案格與風險等級正確。
- 若需要搬移既有資料，匯入 JSON 後再確認草稿與定位。
- 若首頁顯示 404，核對 Root Directory、`public/index.html` 與 Output Directory 是否符合上方設定。
- 若樣式、字型或 PDF 載入失敗，確認整個 `public` 資料夾已上傳，檔名大小寫未變動。
- 若開啟本機 `public/index.html` 無法載入字型／PDF，請使用部署網址，或直接開啟 `public/portable.html` 離線版；拆分檔案版需要經由網站提供資源。

## 八、後續更新

修改 `public` 內的程式後，將更新提交到 Vercel 已連結的 GitHub 儲存庫；若使用 CLI，則在同一資料夾再次執行 `npx vercel@latest --prod`。

`public/portable.html` 已同步更新為三份範本。日後若修改 `templates/*.json`，請在本專案根目錄使用 Python 3.10 以上版本依序執行：

```sh
python scripts/build_templates.py
python scripts/build_portable.py
```

若只修改 `public/app.js`、`engine.js`、`style.css` 或 `index.html`，執行第二個指令更新離線版即可。Vercel 直接提供已產生好的 `public` 內容，不需要在部署設定加入這些建置指令。

部署設定依 Vercel 官方文件整理；實際介面名稱可能隨版本調整。正式上線狀態以你的 Vercel 專案部署結果為準。
