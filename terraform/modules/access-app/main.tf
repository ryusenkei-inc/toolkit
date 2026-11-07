# 許可したメールアドレスだけが、ワンタイムのコードで本人を確認して入れる
resource "cloudflare_zero_trust_access_policy" "allow" {
  account_id = var.account_id
  name       = "${var.name} の許可"
  decision   = "allow"
  include    = [for email in var.allowed_emails : { email = { email = email } }]
}

resource "cloudflare_zero_trust_access_application" "this" {
  account_id       = var.account_id
  name             = var.name
  type             = "self_hosted"
  domain           = var.domain
  session_duration = var.session_duration
  policies         = [{ id = cloudflare_zero_trust_access_policy.allow.id, precedence = 1 }]
}

# Access を通さないパス（生存の確認など）。より具体的なパスのアプリが優先される
resource "cloudflare_zero_trust_access_policy" "bypass" {
  count      = length(var.bypass_paths) > 0 ? 1 : 0
  account_id = var.account_id
  name       = "${var.name} の公開のパス"
  decision   = "bypass"
  include    = [{ everyone = {} }]
}

resource "cloudflare_zero_trust_access_application" "bypass" {
  for_each   = toset(var.bypass_paths)
  account_id = var.account_id
  name       = "${var.name} ${each.value}"
  type       = "self_hosted"
  domain     = "${var.domain}${each.value}"
  policies   = [{ id = cloudflare_zero_trust_access_policy.bypass[0].id, precedence = 1 }]
}
