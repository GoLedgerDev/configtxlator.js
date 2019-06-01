'use strict';
var expect = require('chai').expect;
var index = require('../dist/index.js');
var orgJson = require('./orgJSON.json');
var expectedJSON = require('./result.json');

describe('convert org json into common.config block', () => {
    it('should return ./result.json', () => {
        var result = index.convertOrgJsonToConfigGroup(orgJson);
        expect(JSON.stringify(result)).to.equal(JSON.stringify(expectedJSON));
    });
});