function expandTokens(template, context) {
  const tokens = { date: '2026-05-22', hour: '14:30' };
  return String(template || '')
    .replace(/\{\s*NUMPAGES\s*\}/gi, String(context.pages || ''))
    .replace(/\{\s*PAGE\s*\}/gi, String(context.page || ''))
    .replace(/\$pages\$/gi, String(context.pages || ''))
    .replace(/\$page\$/gi, String(context.page || ''))
    .replace(/\$date\$/gi, tokens.date)
    .replace(/\$time\$/gi, tokens.hour)
    .replace(/\$hour\$/gi, tokens.hour)
    .replace(/\$title\$/gi, context.title || '')
    .replace(/%pages/g, String(context.pages || ''))
    .replace(/%page/g, String(context.page || ''))
    .replace(/%date/g, tokens.date)
    .replace(/%hour/g, tokens.hour)
    .replace(/%time/g, tokens.hour)
    .replace(/%title/g, context.title || '');
}

// Simulate page 1
var ctx1 = { title: 'Test Doc', page: 1, pages: 2 };
console.log('Page 1:');
console.log('  $page$ =', expandTokens('$page$', ctx1));
console.log('  $pages$ =', expandTokens('$pages$', ctx1));
console.log('  full:', expandTokens('Page $page$ of $pages$', ctx1));

// Simulate page 2
var ctx2 = { title: 'Test Doc', page: 2, pages: 2 };
console.log('Page 2:');
console.log('  $page$ =', expandTokens('$page$', ctx2));
console.log('  $pages$ =', expandTokens('$pages$', ctx2));
console.log('  full:', expandTokens('Page $page$ of $pages$', ctx2));

// Edge case: page = 0 (number)
var ctx0 = { title: 'Test', page: 0, pages: 2 };
console.log('Edge page=0:');
console.log('  $page$ =', JSON.stringify(expandTokens('$page$', ctx0)));
console.log('  $pages$ =', expandTokens('$pages$', ctx0));

// Edge case: page = undefined
var ctxU = { title: 'Test', pages: 2 };
console.log('Edge page=undefined:');
console.log('  $page$ =', JSON.stringify(expandTokens('$page$', ctxU)));

// Edge case: page = "0" (string)
var ctxS = { title: 'Test', page: "0", pages: 2 };
console.log('Edge page="0":');
console.log('  $page$ =', JSON.stringify(expandTokens('$page$', ctxS)));
console.log('  $pages$ =', expandTokens('$pages$', ctxS));
