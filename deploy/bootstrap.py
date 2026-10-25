"""Generate private initial deployment secrets without printing them."""
from pathlib import Path
import os
import secrets

root = Path('/opt/apikeywebapp')
if Path.cwd().resolve() != root:
    raise SystemExit('Run only from /opt/apikeywebapp')
os.umask(0o077)
env = root / '.env'
if env.exists():
    raise SystemExit('Existing production environment preserved; bootstrap was not rerun.')
bootstrap = secrets.token_urlsafe(48)
with env.open('x') as output:
    output.write('APP_ORIGIN=https://api.praritsidana.com\n')
    output.write('ENCRYPTION_KEY=' + secrets.token_hex(32) + '\n')
    output.write('BOOTSTRAP_TOKEN=' + bootstrap + '\n')
with (root / '.bootstrap-access.txt').open('x') as output:
    output.write('KeyPool private first-owner access\n\n')
    output.write('Website: https://api.praritsidana.com\n')
    output.write('Setup token: ' + bootstrap + '\n\n')
    output.write('Open the website, enter this token, and choose your email and password.\n')
    output.write('The token stops working after the first owner is created.\n')
    output.write('Never commit or share this file publicly.\n')
print('Private environment and first-owner access file created.')
