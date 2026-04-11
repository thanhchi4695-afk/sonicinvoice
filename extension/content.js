// Sonic Invoices Content Script - Zap Button Injection

(function() {
  'use strict';

  // Only run on product pages
  const isProductPage = () => {
    const url = window.location.pathname;
    return url.includes('/products/') || url.includes('/product/') || 
           document.querySelector('[itemtype*="Product"]') !== null;
  };

  if (!isProductPage()) return;

  // Find the product title element
  const titleSelectors = [
    'h1.product-single__title',
    'h1.product__title',
    'h1[data-product-title]',
    '.product-title h1',
    '.product-info h1',
    'h1.title',
    '[itemprop="name"]',
  ];

  let titleEl = null;
  for (const sel of titleSelectors) {
    titleEl = document.querySelector(sel);
    if (titleEl) break;
  }

  if (!titleEl) return;

  // Create the Zap button
  const zapBtn = document.createElement('button');
  zapBtn.innerHTML = '⚡ Zap';
  zapBtn.className = 'sonic-zap-btn';
  zapBtn.title = 'Check price in Sonic Invoices';

  zapBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const title = titleEl.textContent?.trim() || '';
    
    // Find price on page
    const priceSelectors = [
      '.product__price .money',
      '.product-single__price .money',
      '[data-product-price]',
      '.price .money',
      '.current-price',
      '[itemprop="price"]',
    ];

    let price = null;
    for (const sel of priceSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent || el.getAttribute('content') || '';
        const match = text.match(/[\d,.]+/);
        if (match) {
          price = parseFloat(match[0].replace(/,/g, ''));
          break;
        }
      }
    }

    // Send to extension popup
    chrome.runtime.sendMessage({
      type: 'ZAP_PRODUCT',
      data: { title, price, url: window.location.href },
    });

    // Visual feedback
    zapBtn.innerHTML = '✅ Sent!';
    zapBtn.style.background = '#10b981';
    setTimeout(() => {
      zapBtn.innerHTML = '⚡ Zap';
      zapBtn.style.background = '';
    }, 2000);
  });

  // Insert after the title
  titleEl.parentNode.insertBefore(zapBtn, titleEl.nextSibling);
})();
