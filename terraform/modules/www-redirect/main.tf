# www の DNS はプロキシを通すためだけで、転送先の IP は使わない
resource "cloudflare_dns_record" "www" {
  zone_id = var.zone_id
  name    = "www.${var.domain}"
  type    = "AAAA"
  content = "100::"
  proxied = true
  ttl     = 1
}

locals {
  # 末尾のスラッシュを1つ外したパス（`/` はそのまま。wildcard_replace はどのプランでも使える）
  path = var.strip_trailing_slash ? "wildcard_replace(http.request.uri.path, \"/*/\", \"/$${1}\")" : "http.request.uri.path"
  # 末尾のスラッシュを外す対象のパス
  slash_filter = join(" and ", concat(
    ["http.host eq \"${var.domain}\"", "ends_with(http.request.uri.path, \"/\")", "http.request.uri.path ne \"/\""],
    [for p in var.trailing_slash_exclude : "not starts_with(http.request.uri.path, \"${p}\")"],
  ))
  www_rule = {
    description = "www から apex へ"
    expression  = "(http.host eq \"www.${var.domain}\")"
    action      = "redirect"
    action_parameters = {
      from_value = {
        status_code           = 301
        preserve_query_string = true
        target_url            = { expression = "concat(\"https://${var.domain}\", ${local.path})" }
      }
    }
  }
  slash_rule = {
    description = "末尾のスラッシュを外す"
    expression  = "(${local.slash_filter})"
    action      = "redirect"
    action_parameters = {
      from_value = {
        status_code           = 301
        preserve_query_string = true
        target_url            = { expression = "concat(\"https://${var.domain}\", ${local.path})" }
      }
    }
  }
}

# この phase の ruleset はゾーンに1つしか持てない。会社のゾーンを共有するプロダクトでは使わない
resource "cloudflare_ruleset" "redirect" {
  zone_id = var.zone_id
  name    = coalesce(var.ruleset_name, "${var.domain} の www の転送")
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"
  rules = concat(
    [local.www_rule],
    var.strip_trailing_slash ? [local.slash_rule] : [],
    [for r in var.extra_rules : {
      description = r.description
      expression  = r.expression
      action      = "redirect"
      action_parameters = {
        from_value = {
          status_code           = r.status_code
          preserve_query_string = r.preserve_query_string
          target_url            = r.target_expression != null ? { expression = r.target_expression, value = null } : { expression = null, value = r.target_url }
        }
      }
    }],
  )
}
