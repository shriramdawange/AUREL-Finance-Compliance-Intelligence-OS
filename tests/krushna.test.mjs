import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateGst,ean13CheckDigit,isValidEan13,financialYear,invoiceSerial} from '../src/krushna/domain.ts';
test('intra-state GST splits line tax deterministically',()=>{const x=calculateGst([{quantity:1,unitPrice:100,gstRate:18}],true);assert.deepEqual(x,{taxablePaise:10000,cgstPaise:900,sgstPaise:900,igstPaise:0,totalPaise:11800})});
test('inter-state GST applies IGST only',()=>{const x=calculateGst([{quantity:2,unitPrice:125,gstRate:12}],false);assert.equal(x.cgstPaise,0);assert.equal(x.sgstPaise,0);assert.equal(x.igstPaise,3000);assert.equal(x.totalPaise,28000)});
test('odd paise GST split conserves tax',()=>{const x=calculateGst([{quantity:1,unitPrice:0.10,gstRate:5}],true);assert.equal(x.cgstPaise+x.sgstPaise,1)});
test('EAN-13 checksum validates known example',()=>{assert.equal(ean13CheckDigit('400638133393'),1);assert.equal(isValidEan13('4006381333931'),true);assert.equal(isValidEan13('4006381333932'),false)});
test('Indian financial year starts in April',()=>{assert.equal(financialYear(new Date(2026,2,31)),'2025-26');assert.equal(financialYear(new Date(2026,3,1)),'2026-27')});
test('invoice serial remains within 16 characters',()=>{assert.equal(invoiceSerial('2026-27',1),'KRU/26-27/0001');assert.ok(invoiceSerial('2026-27',1).length<=16)});
