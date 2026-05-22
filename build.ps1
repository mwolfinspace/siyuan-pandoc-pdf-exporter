python -c "import zipfile, os
src = os.getcwd()
files = ['icon.png', 'index.css', 'index.js', 'LICENSE', 'plugin.json', 'preview.png', 'README_EXPORT.md']
i = os.path.join(src, 'i18n')
if os.path.isdir(i):
    for f in os.listdir(i):
        files.append('i18n/' + f)
with zipfile.ZipFile(os.path.join(src, 'package.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for name in files:
        z.write(os.path.join(src, name.replace('/', os.sep)), name)
print('package.zip created (valid ZIP, forward slashes)')
"