const jsdom = require('jsdom').jsdom;
const document = jsdom('<html></html>', {});
const window = document.defaultView;
const $ = require('jquery')(window);
const Promise = require("bluebird");
const rp = require('request-promise');
const request = require('request');
const fs = require('fs-extra');
const path = require('path');

const DIR = './assets/flags/horizontal/';
const url = 'https://commons.m.wikimedia.org/wiki/Category:SVG_sovereign_state_flags';
const countriesInfoUrl = 'https://restcountries.eu/rest/v1/all';

const objectMap = function(fn, inPlace = false) {
    const result = inPlace ? this : {};
    Object.keys(this, (value, key) => {
        result[key] = fn(value, key);
    });
}

//Object.prototype.objMap = objectMap;

const arrayPairsToObject = function() {
    const result = {};
    this.forEach(([key, value]) => {
        result[key] = value;
    });
    return result;
}

Array.prototype.pairsToObject = arrayPairsToObject;

const loadCountriesInformation = function() {
    console.log('Loading countries information.');
    return rp({
        uri: countriesInfoUrl,
        json: true
    }).then(data => {
        console.log('Loaded countries information.');
        return data;
    });
}

const loadWikiPage = function() {
    console.log('Loading wiki page.');
    return rp({
            uri: url,
            transform: function(data) {
                return $(data);
            }
        })
        .then(function($html) {
            const $flags = $html.find('#mw-category-media ul.gallery li.gallerybox');
            console.log(`Found ${$flags.length} flags.`);

            const data = $flags.toArray().map(f => $(f)).map(($flag, i) => {
                const name = $flag.find('.gallerytext a').text().replace('.svg', '').replace('Flag of ', '');
                let image = $flag.find('div.thumb img').attr('src').replace('/wikipedia/commons/thumb', '/wikipedia/commons')
                image = image.split('.svg')[0] + '.svg';
                console.log(`  Successfully parsed ${JSON.stringify(name)}`)
                return {
                    name,
                    image
                }
            });

            return data;
        });
}

const tokenizeName = function(name) {
    return name.toLowerCase().replace(/^the /, '');
}

// map of countries that are undetectable by generic algorithm
// n.b. substring check could be used rather than string equality, but this would
// cause issues for countries like "(South )Sudan", "(Democratic )Republic of the Congo", etc.
// hence, for simplicity, basic algorithm & predefined exceptions map were used rather than complicated algorithm
const undetectableCountries = {
    "Côte d'Ivoire": 'CI',
    "Ireland": 'IE',
    "Macedonia": 'MK',
    "Sao Tome and Principe": 'ST',
    "the Vatican City": 'VA'
}

// tokenize exceptions map
Object.keys(undetectableCountries).forEach(key => {
    const value = undetectableCountries[key];
    delete undetectableCountries[key];
    undetectableCountries[tokenizeName(key)] = value;
});

const findId = function(countries, name) {
    name = tokenizeName(name);
    const country = countries.find(country => {
        return tokenizeName(country.name) === name ||
            (country.altSpellings.map(tokenizeName).indexOf(name) !== -1) ||
            undetectableCountries[name];
    })

    return country && country.alpha2Code;
}

const downloadRemoteFile = function(url, filepath) {
    return new Promise((resolve, reject) => {
        const stream = request(url).pipe(fs.createWriteStream(filepath));
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

Promise.join(loadCountriesInformation(), loadWikiPage(),
        (countries, flags) => {
            return {
                countries,
                flags
            }
        })
    .then(({
        countries,
        flags
    }) => {

        const imageMap = flags.map(({
            name,
            image
        }) => {
            const id = findId(countries, name);
            if (!id) {
                console.log(`Could not find id for ${name}`);
            }

            return [id, image];
        }).pairsToObject();

        return imageMap;
    })
    .then(imageMap => {
        console.log(`Ensuring directory exists: ${DIR}`)
        fs.mkdirp(DIR);

        console.log('Downloading images.')

        Object.keys(imageMap).forEach(cc => {
            const image = imageMap[cc];
            const ext = '.svg';
            const filepath = path.join(DIR, cc + ext);
            // todo: handle promise
            downloadRemoteFile(image, filepath).catch((err) => {
                console.error(`  Failed to download ${cc}`, err);
            }).then(() => {
                console.log(`  Successfully downloaded ${cc}`);
            })
        });
    });
