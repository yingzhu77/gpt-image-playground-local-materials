# 本地主题插画

此目录的第三方图片仅用于 `/workbench` 的 UI 主题展示；图片二进制由 `.gitignore` 排除。它们不是生成参考图，不导入素材库或数据库，也不进入规划、分析、审稿、搜图或生图请求。运行时只读取本地静态文件，不访问第三方图床。

## 来源与授权边界

- 画师：min（作者账号 `minnnnnnnnim`）。
- 作品：《明日方舟》六周年拉特兰主题贺图的第二幅。
- [作者微博](https://weibo.com/2828274924/5161281230737624)
- [同条作者内容的新浪可读页](https://www.sina.cn/news/detail/5161281230737624.html)（页面日期 2025-05-01，含两张图）。
- [作者 X 帖](https://x.com/minnnnnnnim/status/1918628056358383706)
- [本次实际下载的静态镜像](https://tbib.org//images/1052/956ab720ef54f4a833f7df7800a57173b207f964.jpg)
- [镜像信息页](https://tbib.org/index.php?id=26113821&page=post&s=view)
- 下载及检查日期：2026-11-09（Asia/Shanghai）。

作者发布与画面来源已核对；这不代表已取得公开网站再分发或商业使用许可。第三方图片不属于本项目 MIT 授权内容。不得自动提交、推送或部署这些图片到公开仓库或公网。克隆仓库不会包含图片；未在本地配置时，界面显示“主题图未载入”，不使用其他图片替代。

## 实际文件

| 文件 | 格式 | 实际尺寸 | 文件大小 | SHA-256 |
| --- | --- | --- | --- | --- |
| `min-arknights-6th-laterano-original.jpg` | JPEG，sRGB，渐进式 | 1920 × 1080 | 505319 字节 | `e9338ce4488e5eeb1d9a4ec6e5c4f476951c7a9e170a0d31c602e0ba0488b187` |
| `min-arknights-6th-laterano.webp` | WebP，sRGB | 1920 × 1080 | 373788 字节 | `9e3f9c53aa88df2fa4ec9af68a934cd9839f787e39d34770b67343681da8ef7d` |

原始下载文件保持原始字节。派生 WebP 由项目已有 `sharp` 编码，质量参数 82，未裁切、未缩放、未旋转、未镜像、未补画、未超分，未修改 Logo 或版权信息；它不是原图，也不是 4K 图片。

检查使用 `sharp(...).metadata()` 解码，并实际查看了原图：中央偏右红发角色、左侧蓝发角色和行走人物、右侧轮椅人物与红色巴士、下方水面倒影与斑马线、白鸽和左下角《明日方舟》Logo／版权字样完整。下载内容不是 HTML。

## 本地准备方式

在项目根目录执行（仅在已确认本地使用范围时）：

```powershell
curl.exe --location --fail --silent --show-error --max-time 50 'https://tbib.org//images/1052/956ab720ef54f4a833f7df7800a57173b207f964.jpg' --output 'public/local-theme/min-arknights-6th-laterano-original.jpg'
node -e "require('sharp')('public/local-theme/min-arknights-6th-laterano-original.jpg').webp({quality:82}).toFile('public/local-theme/min-arknights-6th-laterano.webp')"
Get-FileHash -Algorithm SHA256 -LiteralPath 'public/local-theme/min-arknights-6th-laterano-original.jpg'
```

展示资源路径：`/local-theme/min-arknights-6th-laterano.webp`。图片加载失败时保留雾灰背景和明确的未载入提示。
