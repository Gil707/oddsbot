const cheerio = require('cheerio');
const _ = require('underscore');
const puppeteer = require('puppeteer');
const config = require('./config');
const html2json = require('html2json').html2json;
const logger = require('logger').createLogger('./logs/oddswork.log');
const moment = require('moment');

let Filter = require('../models/filter');
let CalcFilter = require('../models/calcfilter');
let settings = require('./settings');

async function parseMatches() {

    const browser = await puppeteer.launch({
        timeout: settings.pup_timeout,
        args: config.pupArgs
    });

    const page = await browser.newPage();
    await browser.userAgent(config.userAgent);
    await page.setViewport({width: 1440, height: 960});
    await page.goto(config.soccerUrl).catch((e) => logger.error('Puppeteeer goto Error ', e.stack));
    await page.waitForSelector('#table-matches');
    await page.click('a[id="user-header-timezone-expander"]').catch((e) => logger.error(e.stack));
    await page.waitFor(settings.match_list_load);
    await page.click('a[href="/set-timezone/54/"]').catch((e) => logger.error(e.stack));
    await page.waitFor(settings.timezone_load);

    let content = await page.evaluate(() => document.body.innerHTML);

    let $ = await cheerio.load(content);

    let linksUl = await getMatches($).catch((e) => logger.error('getMatches Error ', e.stack));

    let filteredUl = await procceedLinks(linksUl).catch((e) => logger.error('procceedLinks Error ', e.stack));

    await browser.close();

    return filteredUl;

}

async function parseLeagues() {

    const browser = await puppeteer.launch({
        timeout: settings.pup_timeout,
        args: config.pupArgs
    });

    const page = await browser.newPage();
    await browser.userAgent(config.userAgent);
    await page.setViewport({width: 1440, height: 960});
    await page.goto(config.soccerUrl).catch((e) => logger.error('Puppeteeer goto Error ', e.stack));
    await page.waitForSelector('#table-matches');
    await page.click('a[id="user-header-timezone-expander"]').catch((e) => logger.error(e.stack));
    await page.waitFor(settings.match_list_load);
    await page.click('a[href="/set-timezone/54/"]').catch((e) => logger.error(e.stack));
    await page.waitFor(settings.timezone_load);

    let content = await page.evaluate(() => document.body.innerHTML);

    let $ = await cheerio.load(content);

    let calcLinks = await getLeagues($).catch((e) => logger.error('getLeagues Error ', e.stack));

    let filteredUl = await procceedLinks(calcLinks, 'CalcFilter').catch((e) => logger.error('procceedLinks Error ', e.stack));

    await browser.close();

    return filteredUl;

}


async function parseMatch(matchLink, type = 'json', time) {

    const browser = await puppeteer.launch({
        timeout: settings.pup_timeout,
        args: config.pupArgs
    });
    const page = await browser.newPage();
    await browser.userAgent(config.userAgent);
    await page.setViewport({width: 1440, height: 960});
    await page.goto(matchLink).catch((e) => logger.error('Puppeteeer goto Error ', e.stack));
    await page.waitForSelector('#odds-data-table');

    let content = await page.evaluate(() => document.body.innerHTML);

    let $ = await cheerio.load(content);

    let match = await getMatchData($, time).catch((e) => logger.error('getMatchData Error ', e.stack));

    if (match.pinnacle.odds.length > 0) {

        if (match.pinnacle.hint) {
            await page.hover('[onmouseover="' + match.pinnacle.hint + '"]').catch((e) => logger.error('pinnacle hint empty'));
            await page.waitFor(200);
            let pinacle = await page.evaluate(() => ('<div class="hint-block">' + document.querySelector('#tooltiptext').outerHTML + '</div>')).catch((e) => logger.error('evaluateHint Error ', e.stack));
            match.pinnacle.blob = await getJsonFromHtml(pinacle).catch((e) => logger.error('getJsonFromHtml Error ', e.stack));
        }

        if (match.marathonbet.hint) {
            await page.hover('[onmouseover="' + match.marathonbet.hint + '"]').catch((e) => logger.error('marathonbet hint empty'));
            await page.waitFor(200 + settings.bets_interval);
            let marathonbet = await page.evaluate(() => ('<div class="hint-block">' + document.querySelector('#tooltiptext').outerHTML + '</div>')).catch((e) => logger.error('evaluateHint Error ', e.stack));
            match.marathonbet.blob = await getJsonFromHtml(marathonbet).catch((e) => logger.error('getJsonFromHtml Error ', e.stack));
        }
        if (match.xbet.hint) {
            await page.hover('[onmouseover="' + match.xbet.hint + '"]').catch((e) => logger.error('xbet a hint empty'));
            await page.waitFor(200 + (settings.bets_interval * 2));
            let xbet = await page.evaluate(() => ('<div class="hint-block">' + document.querySelector('#tooltiptext').outerHTML + '</div>')).catch((e) => logger.error('evaluateHint Error ', e.stack));
            match.xbet.blob = await getJsonFromHtml(xbet).catch((e) => logger.error('getJsonFromHtml Error ', e.stack));
        }

        await browser.close();

        match.link = await matchLink;

        return match;
    } else {
        return null;
    }
}

async function procceedLinks(linksUl, type = 'Filter') {

    let countryChamp;

    if (type === 'CalcFilter') {
        countryChamp = await CalcFilter.find({type: 3}).select('value').exec(); // league
    } else {
        countryChamp = await Filter.find({type: 3}).select('value').exec(); // league
    }

    let countryChampArr = await countryChamp.map(e => e.value);

    if (type === 'CalcFilter') {
        linksUl = await linksUl.filter(e => ((e.href.split('/').length - 1) > 3));
    }

    const checker = value =>
        !countryChampArr.some(element => value.href.includes(element));

    return await linksUl.filter(checker);

}


function getMatches($) {
    return new Promise(function (resolve, reject) {

        if ($) {

            let matches = [];
            let now = moment();

            $('#table-matches').find('td.name.table-participant > a').each((index, element) => {
                let href = element.attribs.href;
                let time = ($(element).parent().prev().text());

                if (href.includes('/soccer/') && time.includes(':')) {
                    let timeMoment = moment((time + ':00'), 'HH:mm:ss a');
                    let duration = timeMoment.diff(now, 'minutes');
                    if (duration > (settings.min_duration) && duration < (settings.max_duration)) {
                        matches.push({href: href, time: time});
                    }
                }
            });

            resolve(matches)
        }
        else {
            reject('error')
        }
    });
}

function getLeagues($) {
    return new Promise(function (resolve, reject) {

        if ($) {

            let links = [];

            $('#sports-menu').find('a').each((index, element) => {
                if ((element.attribs.href).includes('soccer')) {
                    links.push({href: element.attribs.href});
                }
            });

            resolve(links)
        }
        else {
            reject('error')
        }
    });
}


function getMatchData($, time) {
    return new Promise(function (resolve, reject) {

        if ($) {

            let breadcrumb = $('div#breadcrumb').find('a');

            let match = {
                title: $('div#col-content > h1').text(),
                date: moment().add(config.timeCorrect, 'hours').format('DD.MM.YYYY') + ' ' + time,
                league: $(breadcrumb[2]).text() + '/' + $(breadcrumb[3]).text(),
                link: '',
                pinnacle: {
                    odds: [],
                    hint: false,
                },
                marathonbet: {
                    odds: [],
                    hint: false,
                },
                xbet: {
                    odds: [],
                    hint: false,
                }
            };

            $('div#odds-data-table')
                .find('table.table-main.detail-odds.sortable')
                .find('tbody')
                .find('a.name2')
                .each(function (index, element) {

                    if ((element.attribs.href).includes('pinnacle')) {

                        let divS = $(element).parent().parent().parent().find('td.right.odds');
                        divS.each(function (i, e) {
                            match.pinnacle.odds.push($(e).text());
                        });
                        match.pinnacle.odds.splice(1, 1);
                        let min = _.indexOf(match.pinnacle.odds, _.min(match.pinnacle.odds));
                        divS.splice(1, 1);
                        try {
                            // here it can broken by html

                            // match.pinnacle.hint = divS[min].attribs.onmouseover;
                            match.pinnacle.hint = divS[min].children[0].attribs.onmouseover;
                        } catch (e) {
                            logger.error('Error in hint ', e.stack);
                        }
                    }
                    if ((element.attribs.href).includes('marathonbet')) {
                        let divS = $(element).parent().parent().parent().find('td.right.odds');
                        divS.each(function (i, e) {
                            match.marathonbet.odds.push($(e).text());
                        });

                        match.marathonbet.odds.splice(1, 1);
                        let min = _.indexOf(match.marathonbet.odds, _.min(match.marathonbet.odds));

                        divS.splice(1, 1);
                        try {
                            match.marathonbet.hint = divS[min].children[0].attribs.onmouseover;
                        } catch (e) {
                            logger.error('Error in hint ', e.stack);
                        }
                    }
                    if ((element.attribs.href).includes('1xbet')) {
                        let divS = $(element).parent().parent().parent().find('td.right.odds');
                        divS.each(function (i, e) {
                            match.xbet.odds.push($(e).text());
                        });

                        match.xbet.odds.splice(1, 1);
                        let min = _.indexOf(match.xbet.odds, _.min(match.xbet.odds));

                        divS.splice(1, 1);
                        try {
                            match.xbet.hint = divS[min].children[0].attribs.onmouseover;
                        } catch (e) {
                            logger.error('Error in hint ', e.stack);
                        }
                    }
                });

            resolve(match)
        }
        else {
            reject('error')
        }
    });
}

function getJsonFromHtml(data) {

    return new Promise(function (resolve, reject) {

        if (data) {

            data = data.split('<br>');

            data[0] = data[0].substring(data[0].indexOf('tooltiptext">') + 13);
            data.splice(-1, 1);

            let blob = {
                items: []
            };

            let maxIncrement = data.length - 3;

            for (let i = 0; i < maxIncrement; i++) {

                let val = html2json(data[i]);

                try {
                    let obj = {
                        date: val.child[0].text.trim().replace(',', ' ' + (new Date()).getFullYear() + ','),
                        val: val.child[1].child[0].text || val.child[1].text,
                        inc_dec: (val.child[3] !== undefined) ? val.child[3].child[0].text : 0
                    };

                    blob.items.push(obj);

                } catch (e) {
                    logger.error(e.stack);
                    logger.error('Error in obj parsing. Broken blob: ' + JSON.stringify(val));
                }

            }

            let odds = html2json(data[data.length - 1]);

            blob.openOdds = {
                date: odds.child[0].text.trim().replace(',', ' ' + (new Date()).getFullYear() + ','),
                val: odds.child[1].child[0].text
            };

            resolve(blob)
        }
        else {
            reject('error')
        }

    });

}

module.exports = {
    parseMatches,
    parseLeagues,
    parseMatch,
};