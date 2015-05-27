
if (typeof OpenGeoportal === 'undefined') 
{
    OpenGeoportal = {};
}
if (typeof OpenGeoportal.Models === 'undefined') 
{
    OpenGeoportal.Models = {};
}



OpenGeoportal.Models.Heatmap = Backbone.Model.extend(
    {

        initialize: function()
        {
            that = this;
	    // add listener for seach events
	    that.backgroundLayer = new OpenLayers.Layer.Stamen("toner-lite");
	    OpenGeoportal.ogp.map.addLayer(that.backgroundLayer);
	    OpenGeoportal.Models.Heatmap.radiusFactor = .9;
            jQuery(document).on("fireSearch", function()
                {
                    that.handleHeatmap(that);
                });
	    jQuery(document).trigger("fireSearch");
        },
        fetchOn: false,
        searcher: function() {return OpenGeoportal.ogp.search;},

	/* 
	   return the url that supplies data for the model
	   url is the same as the last Solr query with an area filter added
	*/
        url: function()
            {
                searcher = OpenGeoportal.ogp.appState.get("queryTerms");
                solr = searcher.getSearchSolrObject();
                solr.enableHeatmap();
                solr.addFilter(solr.createNonGlobalAreaFilter());
                url = solr.getURL();
		        return url;
	    },
	/*
	  called by listener on search change, uses backbone fetch
	*/
	handleHeatmap: function(that)
	{
	    this.fetch({dataType: "jsonp", jsonp: "json.wrf",
			reset: true,
			complete: function(dataObj, success)
			{
			    foo = dataObj;
			    console.log("in heatmap complete " + dataObj.responseJSON.response.numFound);
			    var facetCounts = dataObj.responseJSON.facet_counts;
			    if (facetCounts != null)
				{
				    var facetHeatmaps = facetCounts.facet_heatmaps;
				    bbox_rpt = facetHeatmaps.bbox_rpt;
				    that.drawHeatmapOpenLayers(that, bbox_rpt);
				}
			}});
	},
	/*
	  a new OpenLayers layer object is created every time since its color bands change
	*/
	deleteHeatmapLayer: function(that)
	{
	    try
	    {
		if (that.heatmapLayer != null)
		{
		    OpenGeoportal.ogp.map.removeLayer(that.heatmapLayer);
		    that.heatmapLayer = null;
		}
	    }
	    catch (err)
	    {
		;
	    }
	},

	/*
	  we use a black and white stamen layer so heatmap colors aren't distorted
	  setting the background layer should not be done elsewhere
	*/
	initBackgroundLayer: function(that)
	{
	    if (that.backgroundLayer == null)
	    {
		// hack to set background layer for evaluation
		that.backgroundLayer = new OpenLayers.Layer.Stamen("toner-lite");
		OpenGeoportal.ogp.map.addLayer(that.backgroundLayer);
	    }

	},

	/**
	  create layer with move move listener to display number of documents in cell as a tool tip
	*/
	initHeatmapLayer: function(that)
	{
	    heatmapLayer = new Heatmap.Layer("Heatmap");
	    jQuery("#map").attr("title", "Number of layers =     ");
	    jQuery("#map").tooltip({track: true});
	    OpenGeoportal.ogp.map.events.register("mousemove", OpenGeoportal.ogp.map,
						  function(event) {that.processEvent(that, event);}, 
						  true);
	    return heatmapLayer;

	},

	// when the user moves the mouse we note how may documents are under the cursor
	processEvent: function(that, event)
	{
	    foo = event;
	    pixel = event.xy;
	    mercator = OpenGeoportal.ogp.map.getLonLatFromViewPortPx(pixel);
	    epsg4326 = new OpenLayers.Projection("EPSG:4326");
	    epsg900913 = new OpenLayers.Projection("EPSG:900913");
	    point = mercator.transform(epsg900913, epsg4326);
	    count = getCountGeodetic(that.lastHeatmapObject, point.lat, point.lon);
	    if (count < 0) count = 0;
	    message = "Number of layers = " + count;
	    jQuery("#map").tooltip( "option", "content", message );
	},


	flattenValues: function(heatmap)
	{
	    tmp = [];
	    for (i = 0 ; i < heatmap.length ; i++)
		tmp.push.apply(tmp, heatmap[i]);
	    return tmp;
	},

	/**
	  uses a Jenks algorithm with 5 classifications
	  the library supports many more options
	*/
	getClassifications: function(that, heatmap)
	{
	    flattenedValues = that.flattenValues(heatmap);
            series = new geostats(flattenedValues);

            jenksClassifications = series.getClassJenks(5);
	    return jenksClassifications;
	},

	/*
	  convert Jenks classifications to Brewer colors 
	*/
	getColorGradient: function(that, classifications)
	{
            colors = [0x00000000, 0xfef0d9ff, 0xfdcc8aff, 0xfc8d59ff, 0xe34a33ff, 0xb30000ff];
            colorGradient = {};
            for (var i = 0 ; i < classifications.length ; i++)
	    {
		value = classifications[i];
		scaledValue = that.rescaleHeatmapValue(value, jenksClassifications[0], maxValue);
		if (scaledValue < 0)
		    scaledValue = 0;
		colorGradient[scaledValue] = colors[i];
	    }
	    return colorGradient;
	},
	rescaleHeatmapValue: function(value, min, max)
	{
	    if (value == null)
		return 0;
	    if (value == -1)
		return -1;
	    if (value == 0)
		return 0;
	    value = value * 1.0;
	    return (value * 1.0) / max;
	},

	/**
	   radius of heatmap point depends on how many pixels are between adjacent points
	*/
	computeRadius: function(latitude, longitude, stepSize)
	{
	    mercator1 = OpenGeoportal.ogp.map.WGS84ToMercator(longitude, latitude);
	    pixel1 = OpenGeoportal.ogp.map.getPixelFromLonLat(mercator1);
	    mercator2 = OpenGeoportal.ogp.map.WGS84ToMercator(longitude + stepSize, latitude + stepSize);
	    pixel2 = OpenGeoportal.ogp.map.getPixelFromLonLat(mercator2);
	    deltaLatitude = Math.abs(pixel1.x - pixel2.x);
	    return Math.ceil(deltaLatitude * 2.);
	},


	/**
	   return the largest and smallest value in the heatmap so its values can be scaled
	   some elements in the heatmap can be null, this function replaces the nulls
	*/
	heatmapMinMax: function (heatmap, stepsLatitude, stepsLongitude)
	{
	    var max = -1;
	    var min = Number.MAX_VALUE;
	    for (i = 0 ; i < stepsLatitude ; i++)
	    {
		var currentRow = heatmap[i];
		if (currentRow == null)  heatmap[i] = currentRow = [];
		for (j = 0 ; j < stepsLongitude ; j++)
		{
		    if (currentRow[j] == null)
			currentRow[j] = -1;
		    if (currentRow[j] > max)
			max = currentRow[j];
		    if (currentRow[j] < min && currentRow[j] > -1)
			min = currentRow[j];
		}
	    }
	    return [min, max];
	},


	/**
	   the heatmap object is an array 
	   it has fields for the count array as well as the extent and step sizes
	 */
	drawHeatmapOpenLayers: function(that, heatmapObject)
	{
	    that.lastHeatmapObject = heatmapObject;
	    that.deleteHeatmapLayer(that);
	    //that.initBackgroundLayer(that);
	    that.heatmapLayer = that.initHeatmapLayer(that);
	    that.heatmapLayer.points = [];  //delete any previously added points
	    // get components returned by Solr
	    heatmap = heatmapObject[15];
	    if (heatmap == null)
		return;
	    stepsLatitude = heatmapObject[5];  //heatmap.length;
	    stepsLongitude = heatmapObject[3];   //heatmap[0].length;
	    
	    minMaxValue = that.heatmapMinMax(heatmap, stepsLatitude, stepsLongitude);
	    //ceilingValues = getCeilingValues(heatmap);
	    minValue = minMaxValue[0];
	    maxValue = minMaxValue[1];
	    if (maxValue == -1) return;  // something wrong

	    var minimumLatitude = heatmapObject[11];
	    var maximumLatitude = heatmapObject[13];
	    var deltaLatitude = maximumLatitude - minimumLatitude;
	    var minimumLongitude = heatmapObject[7];
	    var maximumLongitude = heatmapObject[9];
	    var deltaLongitude = maximumLongitude - minimumLongitude;

	    var stepSizeLatitude = deltaLatitude / stepsLatitude;
	    var stepSizeLongitude = deltaLongitude / stepsLongitude;
	    radius = that.computeRadius(minimumLatitude, minimumLongitude, Math.max(stepSizeLatitude, stepSizeLongitude));

	    var classifications = that.getClassifications(that, heatmap);
	    var colrGradient = that.getColorGradient(that, classifications);
	    that.heatmapLayer.setGradientStops(colorGradient);

	    for (var i = 0 ; i < stepsLatitude ; i++)
	    {
		for (var j = 0 ; j < stepsLongitude ; j++)
		{
		    try
		    {
			heatmapValue = heatmap[heatmap.length - i - 1][j];
			currentLongitude = minimumLongitude + (j * stepSizeLongitude) + (.5 * stepSizeLongitude);
			currentLatitude = minimumLatitude + (i * stepSizeLatitude) + (.5 * stepSizeLatitude);
			mercator = OpenGeoportal.ogp.map.WGS84ToMercator(currentLongitude, currentLatitude);
			scaledValue = that.rescaleHeatmapValue(heatmapValue, classifications[1], maxValue);
			if (heatmapValue > 0)
			{
			    heatmapLayer.addSource(new Heatmap.Source(mercator, radius*OpenGeoportal.Models.Heatmap.radiusFactor, scaledValue));
			}
		    }
		    catch (error)
		    {
			console.log("error making heatmap: " + error);
		    }
		}
	    }
	    that.heatmapLayer.setOpacity(0.50);
	    OpenGeoportal.ogp.map.addLayer(that.heatmapLayer);
	}
    }

);
