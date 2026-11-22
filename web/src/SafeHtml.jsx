// Renders HTML from outside sources (the cloud script's reply) the way legacy ng-bind-html did:
// formatting and links are kept, anything else (scripts, styles, event handlers, javascript: URLs)
// is dropped. Built as React elements, so the HTML never goes through innerHTML.
import { createElement, Fragment } from 'react';

const TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'span', 'small', 'sub', 'sup',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'code', 'pre', 'blockquote',
]);
const SAFE_URL = /^(https?:|mailto:)/i;

function convert(node, key) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.tagName.toLowerCase();
  const children = Array.from(node.childNodes, (c, i) => convert(c, i));
  if (!TAGS.has(tag)) {
    // Unknown element: keep its text (like $sanitize), but never script/style contents.
    return tag === 'script' || tag === 'style' ? null : createElement(Fragment, { key }, ...children);
  }
  const props = { key };
  if (tag === 'a') {
    const href = (node.getAttribute('href') ?? '').trim();
    if (SAFE_URL.test(href)) Object.assign(props, { href, target: '_blank', rel: 'noreferrer' });
  }
  if (tag === 'br' || tag === 'hr') return createElement(tag, props);
  return createElement(tag, props, ...children);
}

export default function SafeHtml({ html }) {
  if (html === undefined || html === null || html === '') return null;
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return createElement(Fragment, null, ...Array.from(doc.body.childNodes, (c, i) => convert(c, i)));
}
