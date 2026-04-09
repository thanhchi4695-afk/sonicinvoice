import { describe, it, expect } from 'vitest';
import { generateTags } from '../lib/tag-engine';

describe('7-Layer Tag Formula', () => {
  it('Test 1 — New Jantzen One Piece, Apr26, full price, d-g', () => {
    const tags = generateTags({
      title: 'Jantzen One Piece', brand: 'Jantzen', productType: 'One Pieces',
      arrivalMonth: 'Apr26', priceStatus: 'full_price', isNew: true, specials: ['d-g'],
    });
    expect(tags).toEqual([
      'Womens', 'Swimwear', 'womens swim', 'One Pieces',
      'jantzen', 'Apr26', 'full_price', 'new', 'new arrivals',
      'new swim', 'd-g', 'larger cup',
    ]);
  });

  it('Test 2 — Existing Seafolly Bikini Bottom, Mar26, ON SALE', () => {
    const tags = generateTags({
      title: 'Seafolly Bikini Bottom', brand: 'Seafolly', productType: 'Bikini Bottoms',
      arrivalMonth: 'Mar26', priceStatus: 'sale', isNew: false, specials: [],
    });
    expect(tags).toEqual([
      'Womens', 'Swimwear', 'womens swim', 'bikini bottoms',
      'seafolly', 'Mar26',
    ]);
  });

  it('Test 3 — New Sea Level Swimdress, Apr26, full price', () => {
    const tags = generateTags({
      title: 'Sea Level Swimdress', brand: 'Sea Level', productType: 'Swimdress',
      arrivalMonth: 'Apr26', priceStatus: 'full_price', isNew: true, specials: [],
    });
    expect(tags).toEqual([
      'Womens', 'Swimwear', 'womens swim', 'One Pieces',
      'swimdress', 'sea level', 'Apr26', 'full_price',
      'new', 'new arrivals', 'new swim',
    ]);
  });

  it('Test 4 — Funkita Rashie, chlorine resistant, Apr26', () => {
    const tags = generateTags({
      title: 'Funkita Rashie', brand: 'Funkita', productType: 'Rashies & Sunsuits',
      arrivalMonth: 'Apr26', priceStatus: 'full_price', isNew: false,
      specials: ['chlorine resist'],
    });
    expect(tags).toEqual([
      'Womens', 'Swimwear', 'womens swim',
      'rashies & sunsuits', 'funkita', 'Apr26', 'full_price',
      'Chlorine Resistant',
    ]);
  });

  it('Test 5 — Non-Funkita chlorine resistant one piece', () => {
    const tags = generateTags({
      title: 'Speedo One Piece', brand: 'Speedo', productType: 'One Pieces',
      arrivalMonth: 'Apr26', priceStatus: 'full_price', isNew: false,
      specials: ['chlorine resist'],
    });
    expect(tags).toEqual([
      'Womens', 'Swimwear', 'womens swim', 'One Pieces',
      'speedo', 'Apr26', 'full_price', 'chlorine resist',
    ]);
  });

  it('Test 6 — Funky Trunks Boardshorts, Apr26, full price', () => {
    const tags = generateTags({
      title: 'Funky Trunks Boardshorts', brand: 'Funky Trunks', productType: 'Boardshorts',
      arrivalMonth: 'Apr26', priceStatus: 'full_price', isNew: false,
    });
    expect(tags).toEqual([
      'mens', 'mens swim', 'boardshorts', 'mens boardies',
      'funky trunks', 'Apr26', 'full_price',
    ]);
  });

  it('Test 7 — Seafolly Girls, Girls 8-16, Apr26, full price', () => {
    const tags = generateTags({
      title: 'Seafolly Girls Swimsuit', brand: 'Seafolly Girls', productType: 'Girls 8-16',
      arrivalMonth: 'Apr26', priceStatus: 'full_price', isNew: false,
    });
    expect(tags).toEqual([
      'kids', 'Swimwear', 'Girls swimwear', 'girls 8-16',
      'seafolly girls', 'Apr26', 'full_price',
    ]);
  });

  it('Test 8 — New Boys swimwear, Boys 00-7, Apr26', () => {
    const tags = generateTags({
      title: 'Funkita Boys Swim', brand: 'Funkita', productType: 'Boys 00-7',
      arrivalMonth: 'Apr26', priceStatus: 'full_price', isNew: true,
    });
    expect(tags).toEqual([
      'kids', 'Swimwear', 'boys swim', 'boys 00-7',
      'funkita', 'Apr26', 'full_price', 'new', 'new arrivals',
      'new kids',
    ]);
  });

  it('Test 9 — Le Specs Sunglasses, Apr26, full price', () => {
    const tags = generateTags({
      title: 'Le Specs Sunglasses', brand: 'Le Specs', productType: 'Sunnies',
      arrivalMonth: 'Apr26', priceStatus: 'full_price', isNew: false,
    });
    expect(tags).toEqual([
      'Womens', 'accessories', 'Sunnies', 'sunglasses',
      'le specs', 'Apr26', 'full_price',
    ]);
  });

  it('Test 10 — Earrings, no brand match, Apr26, full price', () => {
    const tags = generateTags({
      title: 'ZODA Earrings', brand: 'ZODA', productType: 'Earrings',
      arrivalMonth: 'Apr26', priceStatus: 'full_price', isNew: false,
    });
    expect(tags).toEqual([
      'JEWELLERY', 'earrings', 'zoda', 'Apr26', 'full_price',
    ]);
  });

  it('Test 11 — Rhythm Womens Dress, new, Apr26, full price', () => {
    const tags = generateTags({
      title: 'Rhythm Dress', brand: 'Rhythm Womens', productType: 'Dresses',
      arrivalMonth: 'Apr26', priceStatus: 'full_price', isNew: true,
    });
    expect(tags).toEqual([
      'Womens', 'clothing', 'womens clothing', 'Dresses',
      'rhythm womens', 'Apr26', 'full_price', 'new',
      'new arrivals', 'new clothing', 'new womens',
    ]);
  });

  it('Test 12 — Pops + Co One Piece from Mar26 invoice', () => {
    const tags = generateTags({
      title: 'Pops + Co One Piece', brand: 'Pops + Co', productType: 'One Pieces',
      arrivalMonth: 'Mar26', priceStatus: 'full_price', isNew: true, specials: [],
    });
    expect(tags).toEqual([
      'Womens', 'Swimwear', 'womens swim', 'One Pieces',
      'pops + co', 'Mar26', 'full_price', 'new', 'new arrivals',
      'new swim',
    ]);
  });
});
