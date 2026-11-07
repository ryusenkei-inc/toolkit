# www の DNS はプロキシを通すためだけで、転送先の IP は使わない
resource "cloudflare_dns_record" "www" {
  zone_id = var.zone_id
  name    = "www.${var.domain}"
  type    = "AAAA"
  content = "100::"
  proxied = true
  ttl     = 1
}

# この phase の ruleset はゾーンに1つしか持てない。会社のゾーンを共有するプロダクトでは使わない
resource "cloudflare_ruleset" "redirect" {
  zone_id = var.zone_id
  name    = "${var.domain} の www の転送"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"
  rules = [{
    description = "www から apex へ"
    expression  = "(http.host eq \"www.${var.domain}\")"
    action      = "redirect"
    action_parameters = {
      from_value = {
        status_code           = 301
        preserve_query_string = true
        target_url            = { expression = "concat(\"https://${var.domain}\", http.request.uri.path)" }
      }
    }
  }]
}
