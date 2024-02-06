/* 
 * Online CSCC browser
 */

import './css/normalize.css';
import './css/main.css';
import './css/cscc.css';
import './css/tippy-light.css';

import tippy from 'tippy.js';

import { select, selectAll, Selection, event } from "d3-selection";
import { geoEquirectangular, geoPath } from "d3-geo";
import { annotation, annotationLabel, annotationCallout } from "d3-svg-annotation";
import { forceSimulation, forceManyBody, forceX, forceY } from "d3-force";
import { csv, json } from "d3-fetch";
import { min, max } from "d3-array";
import { scalePow, scaleLinear } from "d3-scale";
import { interpolateLab } from "d3-interpolate";
import { rgb } from "d3-color";
import { transition, Transition } from "d3-transition";
import { format } from "d3-format";
import { axisBottom, axisLeft } from "d3-axis";
import { line } from "d3-shape";
import * as vsup from "vsup";
import { floatingTooltip } from "./nodetooltip";
import { feature } from 'topojson-client';

var PAR = {
    "db": {
        "ssp": '2',
        "dmg": '1',
        "disc": '1',
        "rcp": '1'
    },
    "curtab": "bubble"
};

const CST = {
    "width": 940,
    "height": 600,
    "sim_target": 0.7,
    "sim_speed": 0.25,
    "sim_force": 0.025,
    "txtdmg": ['BHM SR', 'BHM RP SR', 'BHM LR', 'BHM RP LR'],
    "txtdisc": ['Growth-adjusted', 'Fixed (3%)'],
    "txtssp": [['60', '60', '85', '60', '85'], ['45', '45', '45', '45', '45'], ['60', '60', '60', '60', '60'], ['85', '85', '85', '85', '85']],
    "max_radius_scale": [250, 150]
};

/*
* Annotations to the chart
*/
const annotations = [{
    type: annotationCallout,
    note: {
        label: "Countries with a positive social cost of carbon (more damages).",
        wrap: 220
    },
    x: 355,
    y: 145,
    dy: -50,
    dx: -40,
    connector: { end: "dot" }
},
{
    type: annotationCallout,
    note: {
        label: "Countries with a negative social cost of carbon (more benefits).",
        wrap: 250
    },
    x: 555,
    y: 450,
    dy: 20,
    dx: 80,
    connector: { end: "dot" }
},
{
    type: annotationCallout,
    note: {
        label: "The Global Social Cost of Carbon is the sum of all country-level social costs of carbon.",
        wrap: 250
    },
    connector: { end: "arrow" },
    x: 300,
    y: 600,
    dy: -20,
    dx: -10
}];

/*
* Returns the name of the csv file of current subset of the database
*/
function db_name() {
    return 'data/cscc' + PAR.db.ssp + PAR.db.dmg + PAR.db.disc + PAR.db.rcp + '.csv';
}

function csccChart() {

    // Global SCC value and node (not displayed)
    var gscc = 1000;
    var gscc_node = null;

    // Minimum of cumulative share of SCC (minimum in lorenz curve)
    var min_sscc;

    // maximum of cscc use for scaling
    var max_abs_cscc;

    // bubble scaling
    var radiusScale = null;

    // bubble colors
    var red = "rgb(215,25,28)"; // negative side
    var gray = "rgb(255,255,191)"; // uncertain side
    var blue = "rgb(44,123,182)"; // positive side
    var fillScale = null;

    // color scale in the space [0,0.5,1] (where 0.5 is our zero)
    var interpolateIsoRdBu = scaleLinear()
        .domain([0, 0.5, 1])
        .range([blue, gray, red])
        .interpolate(interpolateLab);

    // tooltip for mouseover functionality
    var tooltip = floatingTooltip('cscc_tooltip');

    // These will be set in create_nodes and create_vis
    var svg = null;
    var inner_svg = null;
    var bubbles = null;
    var bubblesT = null;
    var nodes = [];

    // For lorenz curve
    var xAxis = null;
    var yAxis = null;
    var xScale = null;
    var yScale = null;

    // map projection
    var bubbleProjection = geoEquirectangular()
        .scale(130)
        .translate([CST.width / 2 + 10, CST.height / 2 - 50]);

    // map projection
    var mapProjection = geoEquirectangular()
        .scale(130)
        .translate([CST.width / 2 - 72, CST.height / 2 - 68]);

    // Create simulation
    var simulation = forceSimulation();

    // Stop simulation as there aren't any nodes yet.
    simulation.stop();


    function loadNodes(rawData) {

        // Extract GSCC
        gscc_node = rawData.filter(function (d) {
            if (d.ISO3 == "WLD") { return d; }
        })[0];

        gscc = gscc_node.M;

        //scatterplot
        min_sscc = min(rawData, function (d) {
            return +d.cumscc;
        });

        // Define value and uncertainty domains
        max_abs_cscc = max(rawData, function (d) {
            if (d.ISO3 == "WLD") { return 0; }
            return Math.abs(+d.M);
        });
        var vDom = [-max_abs_cscc, max_abs_cscc];
        var uDom = [0, 1];

        var quantization = vsup.quantization().branching(2).layers(4).valueDomain(vDom).uncertaintyDomain(uDom);
        fillScale = vsup.scale().quantize(quantization).range(interpolateIsoRdBu);

        // Sizes bubbles based on area.
        radiusScale = scalePow()
            //.exponent(0.75)
            //.range([2.5, 80])
            //.domain([0, max_abs_cscc]);
            .exponent(0.66)
            .range([2.5, 100])
            .domain([0, 200]);

    }

    function uncNode(node) {
        return Math.abs(node.high - node.low) / gscc * 1;
    }

    function fillNodes(node) {
        return fillScale(+node.value, uncNode(node));
    }

    function strokeNodes(node) {
        return rgb(fillScale(+node.value, uncNode(node))).darker();
    }

    /*
     * This data manipulation function takes the raw data from
     * the CSV file and converts it into an array of node objects.
     * Each node will store data and visualization values to visualize
     * a bubble.
     *
     * rawData is expected to be an array of data objects, read in from
     * one of d3's loading functions like d3.csv.
     *
     * This function returns the new node array, with a node in that
     * array for each element in the rawData input.
     */
    function createNodes(rawData) {

        loadNodes(rawData);

        // Use map() to convert raw data into node data.
        // Checkout http://learnjsdata.com/ for more on
        // working with data.
        var myNodes = rawData.filter(function (d) {
            if (d.ISO3 != "WLD") { return d; }
        }).map(function (d) {
            return {
                id: +d.id,
                scaled_radius: radiusScale(Math.abs(+d.M)),
                value: +d.M,
                low: +d.L,
                high: +d.H,
                iso3: d.ISO3,
                spop: d.cumpop,
                sscc: d.cumscc,
                Longitude: d.lon,
                Latitude: d.lat,
                country: d.country,
                x: Math.random() * 1000,
                y: Math.random() * 1000
            };
        });

        // sort them to prevent occlusion of smaller nodes.
        myNodes.sort(function (a, b) {
            return b.scaled_radius - a.scaled_radius;
        });

        return myNodes;
    }

    function updateNodes(rawData, nodes) {

        loadNodes(rawData);

        // sort them by id number
        nodes.sort(function (a, b) {
            return a.id - b.id;
        });

        var i = 0;
        rawData.filter(function (d) {
            if (d.ISO3 != "WLD") { return d; }
        }).forEach(function (d) {
            nodes[i].id = +d.id;
            nodes[i].scaled_radius = radiusScale(Math.abs(+d.M));
            nodes[i].value = +d.M;
            nodes[i].low = +d.L;
            nodes[i].high = +d.H;
            nodes[i].spop = d.cumpop;
            nodes[i].sscc = d.cumscc;
            i++;
        });

        // sort them to prevent occlusion of smaller nodes.
        nodes.sort(function (a, b) {
            return b.scaled_radius - a.scaled_radius;
        });

        svg.selectAll('.bcscc')
            .data(nodes, function (d) {
                return "id" + d.id;
            })
            .attr('fill', fillNodes)
            .attr('stroke', strokeNodes)
            .transition()
            .duration(1000)
            .attr('r', function (d) {
                return d.scaled_radius;
            });

        // Text bubble
        svg.selectAll('.tcscc')
            .data(nodes)
            .text(function (node) {
                if (node.scaled_radius > 20) {
                    return node.iso3;
                } else {
                    return null;
                }
            });

        simulation.nodes(nodes);
    }

    function annotate(i) {
        if (svg != null) {
            if (i < 0) {
                svg.selectAll('.annotation-group').remove();
            } else {
                // annotation
                const makeAnnotations = annotation()
                    .type(annotationLabel)
                    .annotations([annotations[i]]);

                svg.append("g")
                    .attr("class", "annotation-group")
                    .call(makeAnnotations);
            }
        }
    }

    /*
 * Main entry point to the bubble chart. This function is returned
 * by the parent closure. It prepares the rawData for visualization
 * and adds an svg element to the provided selector and starts the
 * visualization creation process.
 *
 * selector is expected to be a DOM element or CSS selector that
 * points to the parent element of the bubble chart. Inside this
 * element, the code will add the SVG continer for the visualization.
 *
 * rawData is expected to be an array of data objects as provided by
 * a d3 loading function like d3.csv.
 */
    var chart = function chart(selector, rawData) {
        // convert raw data into nodes data
        nodes = createNodes(rawData);

        // Create a SVG element inside the provided selector
        // with desired size.
        svg = select(selector)
            .append('svg')
            .attr('width', CST.width)
            .attr('height', CST.height);

        // Create an inner SVG panel with padding on all sides for axes
        inner_svg = svg.append("g")
            .attr("transform", "translate(" + 80 + "," + 20 + ")");

        // Create a container for the map before creating the bubbles
        // Then we will draw the map inside this container, so it will appear behind the bubbles
        inner_svg.append("g")
            .attr("class", "world_map_container");

        // Bind nodes data to what will become DOM elements to represent them.
        bubbles = svg.selectAll('.bcscc')
            .data(nodes, function (d) {
                return "id" + d.id;
            });

        // Create new circle elements each with class `bubble`.
        // There will be one circle.bubble for each object in the nodes array.
        // Initially, their radius (r attribute) will be 0.
        // @v4 Selections are immutable, so lets capture the
        //  enter selection to apply our transtition to below.
        var bubblesE = bubbles.enter().append('circle')
            .classed('bcscc', true)
            .attr('r', 0)
            .attr('fill', fillNodes)
            .attr('stroke', strokeNodes)
            .attr('stroke-width', 1)
            .on('mouseover', showDetail)
            .on('mouseout', hideDetail);

        // @v4 Merge the original empty selection and the enter selection
        bubbles = bubbles.merge(bubblesE);

        // Text bubble
        bubblesT = svg.selectAll(null)
            .data(nodes)
            .enter()
            .append('text')
            .classed('tcscc', true)
            .text(function (node) {
                if (node.scaled_radius > 30) {
                    return node.iso3;
                } else {
                    return null;
                }
            })
            .attr("dy", 5)
            .attr('text-anchor', 'middle')
            .attr('font-size', 13)
            .style('fill', 'black')
            .attr('opacity', 0.66);

        // Fancy transition to make bubbles appear, ending with the
        // correct radius
        bubbles
            .transition()
            .duration(1000)
            .attr('r', function (d) {
                return d.scaled_radius;
            });

        // Set the simulation's nodes to our newly created nodes array.
        // @v4 Once we set the nodes, the simulation will start running automatically!
        simulation.nodes(nodes);

        // Set initial layout to single group.
        csccBubbles();

    };

    /*
 * Callback function that is called after every tick of the
 * force simulation.
 * Here we do the acutal repositioning of the SVG circles
 * based on the current x and y values of their bound node data.
 * These x and y values are modified by the force simulation.
 */
    function ticked() {
        if (simulation.alpha() < (CST.sim_target + 1e-4)) {
            simulation.stop();
        }
        bubbles
            .attr('cx', function (d) {
                return d.x;
            })
            .attr('cy', function (d) {
                return d.y;
            });
        bubblesT.attr('x', function (d) {
            return d.x;
        })
            .attr('y', function (d) {
                return d.y;
            });
    }

    function cleanTab(tab) {
        if (svg != null) {
            annotate(-1);
            if (tab != "bubble") {
                inner_svg.selectAll('.legend').remove();
            }
            if (tab != "lorenz") {
                inner_svg.selectAll('.axis').remove();
                inner_svg.selectAll('.curve').remove();
                selectAll(".bcscc")
                    .style("fill-opacity", 1);
            }
            if (tab != "worldmap") {
                inner_svg.selectAll('.world_map').remove();
            }
        }
    }

    function moveBubbles() {

        var targetFunction;

        if (PAR.curtab == "bubble") {
            targetFunction = function (node) {
                if (node.value > 0) {
                    return PAR.gridCenters.pos;
                } else {
                    return PAR.gridCenters.neg;
                }
            };
            // legend
            inner_svg.selectAll('.legend').remove();
            var bubbleFillLegend = vsup.legend.arcmapLegend();
            bubbleFillLegend
                .scale(fillScale)
                .x(650)
                .y(220)
                .size(140)
                .vtitle("CSCC")
                .utitle("Uncertainty");

            inner_svg.append("g")
                .call(bubbleFillLegend);

            //inner_svg.append("g")
        }

        if (PAR.curtab == "lorenz") {
            targetFunction = function (node) {
                return {
                    x: xScale(+node.spop) - 40,
                    y: yScale(+node.sscc * gscc) - 20
                };
            };

        }

        if (PAR.curtab == "worldmap") {
            targetFunction = function (node) {
                return {
                    x: bubbleProjection([+node.Longitude, +node.Latitude])[0],
                    y: bubbleProjection([+node.Longitude, +node.Latitude])[1]
                };
            };

            // legend
            inner_svg.selectAll('.legend').remove();
            var bubbleFillLegend = vsup.legend.arcmapLegend();
            bubbleFillLegend
                .scale(fillScale)
                .x(650)
                .y(400)
                .size(140)
                .vtitle("CSCC")
                .utitle("Uncertainty");

            inner_svg.append("g")
                .call(bubbleFillLegend);

        }

        // Given the mode we are in, obtain the node -> target mapping
        var targetForceX = forceX(function (node) {
            return targetFunction(node).x;
        })
            .strength(+CST.sim_force);
        var targetForceY = forceY(function (node) {
            return targetFunction(node).y;
        })
            .strength(+CST.sim_force);

        // Specify the target of the force layout for each of the circles
        simulation
            .force("x", targetForceX)
            .force("y", targetForceY);

        // Restart the force layout simulation
        simulation.alphaTarget(+CST.sim_target).restart();

    }

    /*
     * TAB 1 : Bubbles
     */
    function csccBubbles() {

        cleanTab("bubble");
        addForceLayout(false);

        annotate(0);
        annotate(1);
        annotate(2);

        // Bubble centers
        PAR.gridCenters = {};
        PAR.gridCenters.neg = {
            x: CST.width / 2,
            y: 5 * CST.height / 9
        };
        PAR.gridCenters.pos = {
            x: CST.width / 2,
            y: 4 * CST.height / 9
        };

        moveBubbles();

    }

    /*
     * TAB 2 : lorenzCurve
     */
    function lorenzBubbles() {

        cleanTab("lorenz");
        addForceLayout(true);

        // axis
        //{top: 20, right: 20, bottom: 50, left: 80}
        xScale = scaleLinear().range([120, CST.width - 20])
            .domain([0, 1]);
        yScale = scaleLinear().range([CST.height - 30, 50])
            .domain([min_sscc * gscc * 1.05, 1 * gscc * 1.05]);

        // Set up axes
        xAxis = xScale;
        yAxis = yScale;

        inner_svg.append("g")
            .attr("class", "axis axis--x")
            .attr("transform", "translate(-120," + (+CST.height - 70) + ")")
            .call(axisBottom(xAxis));

        inner_svg.append("text")
            .attr("class", "axis axis--x--label")
            .attr("transform", "translate(" + (CST.width / 2) + " , " + (+CST.height - 70) + ")")
            .attr('dominant-baseline', 'hanging')
            .attr("dy", "1.5em")
            .style("text-anchor", "middle")
            .text("Cumulative population share in 2020");

        inner_svg.append("g")
            .attr("class", "axis axis--y")
            .attr("transform", "translate(0," + -40 + ")")
            .call(axisLeft(yAxis).ticks(10));

        inner_svg.append("text")
            .attr("class", "axis axis--y--label")
            // We need to compose a rotation with a translation to place the y-axis label
            .attr("transform", "translate(" + 0 + ", " + (CST.height / 2) + ")rotate(-90)")
            .attr("dy", "-3em")
            .attr("text-anchor", "middle")
            .text("Cumulative CSCC [USD/tCO2]");

        var axis0 = [{ "x": 0, "y": 0 }, { "x": 1, "y": 0 }];
        var lineFunction = line()
            .x(function (d) { return xScale(d.x) - 120; })
            .y(function (d) { return yScale(d.y) - 40; });

        inner_svg.append("path")
            .attr("class", "axis axis--x0")
            .attr("d", lineFunction(axis0))
            .attr("stroke", "black")
            .attr("stroke-width", 0.5)
            .attr("fill", "none");

        var onevalue = [{ "x": 0, "y": 0 }, { "x": 1, "y": gscc }];

        inner_svg.append("path")
            .attr("class", "axis one2one")
            .attr("d", lineFunction(onevalue))
            .attr("stroke", "steelblue")
            .attr("stroke-width", 1)
            .style("stroke-dasharray", ("3, 3"))
            .attr("fill", "none");

        var lorenzFunction = line()
            .x(function (node) { return xScale(+node.spop) - 120; })
            .y(function (node) { return yScale(+node.sscc * gscc) - 40; });

        nodes.sort(function (a, b) {
            return b.spop - a.spop;
        });

        inner_svg.append("path")
            .attr("class", "axis lorenz")
            .attr("d", lorenzFunction(nodes))
            .attr("stroke", "steelblue")
            .attr("stroke-width", 1)
            .attr("fill", "none")
            .attr("stroke-linejoin", "round")
            .attr("stroke-linecap", "round");

        nodes.sort(function (a, b) {
            return b.scaled_radius - a.scaled_radius;
        });

        selectAll(".bcscc")
            .transition()
            .style("fill-opacity", 0.8);

        moveBubbles();

    }

    function updateSSPlorenzBubbles() {

        yScale = scaleLinear().range([CST.height - 30, 50])
            .domain([min_sscc * gscc * 1.05, 1 * gscc * 1.05]);

        yAxis = yScale;

        selectAll(".axis--y")
            .transition()
            .duration(500)
            .call(axisLeft(yAxis).ticks(10));

        selectAll(".axis--x0").remove();
        var axis0 = [{ "x": 0, "y": 0 }, { "x": 1, "y": 0 }];
        var lineFunction = line()
            .x(function (d) { return xScale(d.x) - 120; })
            .y(function (d) { return yScale(d.y) - 40; });

        inner_svg.append("path")
            .attr("class", "axis axis--x0")
            .attr("d", lineFunction(axis0))
            .attr("stroke", "black")
            .attr("stroke-width", 0.5)
            .attr("fill", "none");

        selectAll(".one2one").remove();
        var onevalue = [{ "x": 0, "y": 0 }, { "x": 1, "y": gscc }];

        inner_svg.append("path")
            .attr("class", "axis one2one")
            .attr("d", lineFunction(onevalue))
            .attr("stroke", "steelblue")
            .attr("stroke-width", 1)
            .style("stroke-dasharray", ("3, 3"))
            .attr("fill", "none");

        selectAll(".lorenz").remove();

        var lorenzFunction = line()
            .x(function (node) { return xScale(+node.spop) - 120; })
            .y(function (node) { return yScale(+node.sscc * gscc) - 40; });

        nodes.sort(function (a, b) {
            return b.spop - a.spop;
        });

        inner_svg.append("path")
            .attr("class", "axis lorenz")
            .attr("d", lorenzFunction(nodes))
            .attr("stroke", "steelblue")
            .attr("stroke-width", 1)
            .attr("fill", "none")
            .attr("stroke-linejoin", "round")
            .attr("stroke-linecap", "round");

        nodes.sort(function (a, b) {
            return b.scaled_radius - a.scaled_radius;
        });


        selectAll(".bcscc")
            .transition()
            .style("fill-opacity", 0.5);
    }


    /*
   * TAB 3 : World map
   */
    function worldBubbles() {

        cleanTab("worldmap");
        addForceLayout(true);

        // display map
        var path = geoPath().projection(mapProjection);


        json("img/world-110m.json")
            .then(function (topo) {

                inner_svg.selectAll(".world_map_container")
                    .append("g")
                    .attr("class", "world_map")
                    .selectAll("path")
                    .data(feature(topo, topo.objects.countries).features)
                    .enter()
                    .append("path")
                    .attr("d", path);

            });

        moveBubbles();

    }

    /*
     * Function called on mouseover to display the
     * details of a bubble in the tooltip.
     */
    function showDetail(d) {
        // change outline to indicate hover state.
        select(this).attr('stroke', 'black');
        var value1;
        value1 = format(",.3r")(d.value);
        var value0;
        value0 = format(",.3r")(d.low);
        var value2;
        value2 = format(",.3r")(d.high);
        var value3;
        value3 = format(",.2r")(uncNode(d));
        var content =
            d.country + ' (' + d.iso3 + ')<br/>CSCC: ' +
            value1 + '$/tCO<sub>2</sub> [' +
            value0 + ';' + value2 + ']<br/>Unc.: ' +
            value3
            ;
        tooltip.showTooltip(content, event);
    }

    /*
     * Hides tooltip
     */
    function hideDetail(d) {
        // reset outline
        select(this)
            .attr('stroke', strokeNodes);
        tooltip.hideTooltip();
    }

    chart.changeTab = function () {
        switch (PAR.curtab) {
            case 'bubble':
                csccBubbles();
                break;
            case 'lorenz':
                lorenzBubbles();
                break;
            case 'worldmap':
                worldBubbles();
                break;
        }
    };

    chart.updateDb = function () {

        csv(db_name()).then(function display2(data) {

            updateNodes(data, nodes);

            updateText();

            if (PAR.curtab == 'lorenz') {
                updateSSPlorenzBubbles();
            }

            moveBubbles();

            simulation.alpha(1).alphaTarget(+CST.sim_target).restart();

        });

    };


    function updateText() {
        document.getElementById("gscc").textContent = Math.round(gscc);
        document.getElementById("gscc_l").textContent = Math.round(gscc_node.L);
        document.getElementById("gscc_h").textContent = Math.round(gscc_node.H);
        document.getElementById("txtdmg").textContent = CST.txtdmg[+PAR.db.dmg - 1];
        document.getElementById("txtdisc").textContent = CST.txtdisc[+PAR.db.disc - 1];
        for (let i = 0; i < 5; i++) {
            document.getElementById("ssp" + (i + 1)).textContent = 'SSP' + (i + 1) + '/RCP' + CST.txtssp[+PAR.db.rcp - 1][i];
        }
    }


    function addForceLayout(isStatic) {
        function bubbleCharge(d) {
            return -Math.pow(d.scaled_radius, 2.0) * (+CST.sim_force);
        }
        if (simulation) {
            simulation.stop();
        }
        // Configure the force layout holding the bubbles apart
        simulation = forceSimulation()
            .nodes(nodes)
            .velocityDecay(+CST.sim_speed)
            .on("tick", ticked);

        if (!isStatic) {
            simulation
                .force('charge', forceManyBody().strength(bubbleCharge));
        }
    }

    // return the chart function from closure.
    return chart;

}

/*
 * Below is the initialization code as well as some helper functions
 * to create a new bubble chart instance, load the data, and display it.
 */

var myChart = csccChart();

/*
 * Function called once data is loaded from CSV.
 * Calls bubble chart function to display inside #vis div.
 */
function display(data) {
    myChart('#cscc', data);
}

/*
 * Sets up the layout buttons to allow for toggling between view modes.
 */
function setupButtons() {
    select('#toolbar')
        .selectAll('.button')
        .on('click', function () {
            // Remove active class from all buttons
            selectAll('.button').classed('active', false);
            // Find the button just clicked
            var button = select(this);

            // Set it as the active button
            button.classed('active', true);

            // Get the id of the button
            PAR.curtab = button.attr('id');

            // Toggle the bubble chart based on
            // the currently clicked button.
            myChart.changeTab();

            event.preventDefault();
        });

    select('#toolbar_ssp')
        .selectAll('.ssp')
        .on('click', function () {


            selectAll('.ssp').classed('active', false);
            var ssp = select(this);
            ssp.classed('active', true);

            // Toggle the bubble chart based on
            // the currently clicked button.

            PAR.db.ssp = ssp.attr('id').substring(3, 4);

            myChart.updateDb();

            event.preventDefault();
        });

}

// Load the data.
csv(db_name())
    .then(display);

// Setup Buttons
setupButtons();

const tip_sel_dmg = tippy(document.querySelector('.seldmg'), {
    delay: 100,
    arrow: true,
    arrowType: 'sharp',
    duration: 500,
    animation: 'fade',
    placement: 'bottom',
    theme: 'light round',
    html: '#select-dmgfun',
    interactive: true,
    trigger: 'click',
    onShown() {
        selectAll("input[name='dmgfun']")
            .on('change', function () {
                PAR.db.dmg = select(this).property('value');
                myChart.updateDb();
            });
    },
});

const tip_sel_disc = tippy(document.querySelector('.seldisc'), {
    delay: 100,
    arrow: true,
    arrowType: 'sharp',
    duration: 500,
    animation: 'fade',
    placement: 'bottom',
    theme: 'light round',
    html: '#select-discount',
    interactive: true,
    trigger: 'click',
    onShown() {
        selectAll("input[name='discount']")
            .on('change', function () {
                PAR.db.disc = select(this).property('value');
                myChart.updateDb();
            });
    },
});

const tip_sel_rcp = tippy(document.querySelector('.selrcp'), {
    delay: 100,
    arrow: true,
    arrowType: 'sharp',
    duration: 500,
    animation: 'fade',
    placement: 'bottom',
    theme: 'light round',
    html: '#select-rcp',
    interactive: true,
    trigger: 'click',
    onShown() {
        selectAll("input[name='rcp']")
            .on('change', function () {
                PAR.db.rcp = select(this).property('value');
                myChart.updateDb();
            });
    },
});