resource "cloudflare_dns_record" "this" {
  # キーは型・名前・内容のハッシュ。同じ名前と型の複数のレコードを持て、並べ替えても作り直さない
  for_each = { for r in var.records : "${r.type}:${r.name}:${substr(sha1(r.content), 0, 8)}" => r }

  zone_id  = var.zone_id
  name     = each.value.name
  type     = each.value.type
  content  = each.value.content
  ttl      = each.value.ttl
  priority = each.value.priority
  proxied  = each.value.proxied
  comment  = each.value.comment
}
