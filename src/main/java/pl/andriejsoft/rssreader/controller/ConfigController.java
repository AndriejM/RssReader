package pl.andriejsoft.rssreader.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import pl.andriejsoft.rssreader.document.Config;
import pl.andriejsoft.rssreader.service.ConfigService;

import java.util.List;

@RestController
@RequestMapping("/config")
public class ConfigController {

    @Autowired
    private ConfigService configService;

    @GetMapping("/findAll")
    public List<Config> getConfigs() {

        return configService.findAll();
    }

    @PostMapping("/add")
    public String saveConfig(@RequestBody Config config) {
        configService.save(config);
        return "Added Successfully";
    }

    @DeleteMapping("/delete/{uuid}")
    public String deleteConfig(@PathVariable String uuid){
        configService.deleteByUuid(uuid);
        return "Deleted Successfully";
    }
}
