# Search Console のドメインのプロパティの所有権の確認の TXT（apex に置く）
# 値は Search Console の画面か `ryusenkei-search-console token <ドメイン>`（@ryusenkei/scripts）で得る
resource "cloudflare_dns_record" "verification" {
  for_each = toset([for t in var.tokens : startswith(t, "google-site-verification=") ? t : "google-site-verification=${t}"])

  zone_id = var.zone_id
  name    = var.domain
  type    = "TXT"
  content = "\"${each.value}\""
  ttl     = 1
  comment = "Search Console の所有権の確認"
}
