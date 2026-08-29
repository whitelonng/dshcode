# credentials/：凭据与授权

[English](README.md) | 中文

凭据能力家族将引用解析与提供方分离，并把二者与"必须开口去要才能拿到的凭据"再分开：

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`credentials/`](credentials/README.zh.md) | 凭据引用与凭据记录 seam | `ctx.credentials` |
| [`credentials-local/`](credentials-local/README.zh.md) | 环境与本地文件提供方 | 注册 `ctx.credentials` |
| [`authorization/`](authorization/README.zh.md) | 由插件拥有、通过询问人来取得凭据的 flow | `ctx.authorization` |

配置携带引用而非机密值。消费方在其操作边界解析这些引用；变更、优先级与存储语义由子级 README 负责。授权 flow 写入一条凭据记录并以它为键，因此两个 seam 只在记录处相交，别无其他接触面。

子系统参考——`CredentialRef`、按操作解析、对 UI 安全的 `CredentialInfo`、提供方层——见 [docs/subsystems/credentials.md](../../docs/subsystems/credentials.zh.md)。
