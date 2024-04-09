import chai from 'chai';
const should = chai.should();
import { parseMultilineRSAKey } from "../src/parsing";

try {
  
console.clear()
// [parseMultilineRSAKey] valid input
console.log('Testing: [parseMultilineRSAKey] valid input')
{
    const expected = `-----BEGIN RSA PRIVATE KEY-----
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
eeeeeeeeeeeeeeeeeeeeeeeeeee
-----END RSA PRIVATE KEY-----`
    const input = '-----BEGIN RSA PRIVATE KEY-----;aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc;dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd;eeeeeeeeeeeeeeeeeeeeeeeeeee;-----END RSA PRIVATE KEY-----'
    should.equal(parseMultilineRSAKey(input), expected, '[parseMultilineRSAKey] valid input')
}
console.log('Tested: [parseMultilineRSAKey] valid input\n\n')


console.log('Testing: [parseMultilineRSAKey] invalid input')
{
    const expected = null
    const input = ''
    should.equal(parseMultilineRSAKey(input), expected, '[parseMultilineRSAKey] invalid input')
}
console.log('Tested: [parseMultilineRSAKey] invalid input\n\n')
} catch(err: any) {
  console.log(err?.message ?? err)
}
