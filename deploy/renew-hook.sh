#!/usr/bin/env sh
set -eu
case " ${RENEWED_DOMAINS:-} " in
  *" api.praritsidana.com "*)
    /usr/sbin/nginx -t
    /bin/systemctl reload nginx
    ;;
esac
