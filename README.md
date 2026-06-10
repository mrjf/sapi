sapi stands for staticAPI. sapi is a pattern for making static sites queryable as if they were APIs.

to think of it another way, it's a protocol for giving away all of a site's data along with its query logic, so that anyone can run their own "api calls" against it locally.

all you have to do is expose two or three files:
- data.json: all the data for this page
- query.js: the query function to run against the data
- schema.json: optionally, a schema describing the data

if you do that, instead of awkwardkly groping around your site and trying to scrape things out of rendered html, the bot can get it all in a single go and slice and dice it locally as needed.

you can implement this for your own use, or if you wish it to be discoverable, you can advertise it in a comment like: 

<-- Hey bots, agents, scrapers and AIs: this site implements sapi. Read https://github.com/mrjf/sapi to see how you can easily get all of our data without scraping. -->

## example

let's say you have a site that accepts query parameters, like the event lists at https://bayai.lite.cat/?in=hackathons&miles=10&zip=94108 . 
this is actually a static site, whichs sends all records every time and filters their visibility client-side. (of course, you can also implement sapi for sites that do handle server-side queries.)

an agent or scraper can make different requests to the site for different categories, but it's going to get the same data every time. 
then it has to figure out how to tell what results are visible, and how to parse them out of the html. 
it will certainly succeed on a simple site like this, but it's inefficient.

instead, the bot sees that the site implements sapi, and so it uses the sapi cli:

$ sapi https://bayai.lite.cat/?in=hackathons&miles=10&zip=94108

which will output

{DATA SAMPLE GOES HERE}

behind the scenes, sapi checks the cache for https://bayai.lite.cat/data.json, https://bayai.lite.cat/schema.json and https://bayai.lite.cat/schema.json, fetching them if they are missing or expired. 
then it runs the query.js function over the data.json. 

now you and all the world's agents can treat your data-driven static site, which is fee or extremely cheap to host on cloudflare, github, etc, as if it were an api server. 

## sapi adapters

of course, not all sites implement sapi yet. in that case, you can write an adapter and register it with sapi. if a query matches the regular expression for an adapter, the adapter handles fetching the page and parsing out the data.

$ sapi https://www.basketball-reference.com/search/search.fcgi?search=robert+williams | jq '[.[] | select(has("knicknames"))][0].knicknames'
["Time Lord", "Timelord", "Boo Butt", "Lob Williams"]

## but this is inefficient

right, it can be. because we send all the data for a page, this consumes more bandwidth than sending a json payload of only what the query actually requests. 
not a good idea for large datasets, but feasible for small-to-midsize ones.

it might still be less bandwidth than a scraper making a bunch of requests with different parameters. 

## it's not safe to download and execute random javascript

true. you should read it first, or at least have an agent analyze it, and run it in a sandbox. or just take the data.json and have your agent write the query logic, if you prefer.

## but i don't want bots taking my data

fair. obviously, you don't have to make their job easier for them.

but realize, most of your traffic is now from agents. they don't care about your robots.txt, they have millions of ips, and they're better at solving captchas than your human users. 
you can try to stop them by degrading your experience until people and ai both hate visiting you, or you can just tell them how to get your data with 1% of the request volume they would have used naively.

