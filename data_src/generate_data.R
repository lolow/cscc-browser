# generate_data.R
# generate data file for the cscc browser using the CSV database file of CSCC

library(tidyverse)
library(data.table)
library(countrycode)
library(stringr)

# load data
load('data_src/allgdp.RData')
db <- fread('data_src/cscc_v2.csv')
centroid <- fread('data_src/country_centroids_az8.csv')

# Add informative variables
#db[, disc := ifelse(is.na(dr), "var", "fix")]
db[dr == 3, disc := "fix"]
db[prtp == 2 & eta == "1p5", disc := "var"]
db = db[!is.na(disc)]
db[, country := countrycode(ISO3, 'iso3c', 'country.name')]

# Add population in 2020
db = merge(db,
           gdpcap[year == 2020 & SSP == "SSP2", .(ISO3, pop)],
           by = c("ISO3"),
           all.x = T)

# Add centroid to countries
db = merge(db,
           centroid[, .(ISO3 = adm0_a3, lon = Longitude, lat = Latitude)],
           by = c("ISO3"),
           all.x = T)

# Default specification
#run0 <- "bhm_sr"
dmgfuncpar0 <- "bootstrap"
climate0 <- "uncertain"
SSP0 <- "SSP2"
RCP0 <- "rcp60"
#disc0 <- "var"

runs = c("bhm_sr", "bhm_richpoor_sr", "bhm_lr", "bhm_richpoor_lr")
discs = c("var", "fix")

for (i in 1:5) {
  for (j in 1:4) {
    for (k in 1:2) {
      for (l in 1:4) {
        SSP0 <- str_glue('SSP{i}')
        if (l == 1 & SSP0 == "SSP1") {
          RCP0 <- "rcp60"
        }
        if (l == 1 & SSP0 == "SSP2") {
          RCP0 <- "rcp60"
        }
        if (l == 1 & SSP0 == "SSP3") {
          RCP0 <- "rcp85"
        }
        if (l == 1 & SSP0 == "SSP4") {
          RCP0 <- "rcp60"
        }
        if (l == 1 & SSP0 == "SSP5") {
          RCP0 <- "rcp85"
        }
        if (l == 2) {
          RCP0 <- "rcp45"
        }
        if (l == 3) {
          RCP0 <- "rcp60"
        }
        if (l == 4) {
          RCP0 <- "rcp85"
        }
        
        
        dd <-
          db[run == runs[j] &
               dmgfuncpar == dmgfuncpar0 & climate == climate0 &
               SSP == SSP0 &
               RCP == RCP0 & disc == discs[k] & ISO3 != "WLD",
             .(
               ISO3,
               country,
               L = `16.7%`,
               M = `50%`,
               H = `83.3%`,
               pop,
               lon,
               lat
             )]
        
        # Lorenz Curve
        neworder = order(dd$M / dd$pop)
        dd = dd[neworder]
        dd[, cumscc := cumsum(M / sum(M))]
        dd[, cumpop := cumsum(pop / sum(pop))]
        dd[, pop := NULL]
        
        dd <- rbindlist(list(dd,
                             db[run == runs[j] &
                                  dmgfuncpar == dmgfuncpar0 &
                                  climate == climate0 &
                                  SSP == SSP0 &
                                  RCP == RCP0 &
                                  disc == discs[k] & ISO3 == "WLD",
                                .(
                                  ISO3,
                                  country,
                                  L = `16.7%`,
                                  M = `50%`,
                                  H = `83.3%`,
                                  cumscc = 0,
                                  cumpop = 0,
                                  lon = 0,
                                  lat = 0
                                )]))
        dd = dd[order(ISO3)]
        dd[, id := .I]
        
        if (str_glue('{i}{j}{k}{l}') != '2111') {
          dd[,lon := NULL]
          dd[,lat := NULL]
          dd[,country := NULL]
        }
        
        fwrite(dd, str_glue('dist/data/cscc{i}{j}{k}{l}.csv'))
        
      }
    }
  }
}
