package pl.andriejsoft.rssreader.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import pl.andriejsoft.rssreader.entity.ConfigEntity;
import pl.andriejsoft.rssreader.service.ConfigService;

import java.util.List;

@RestController
@RequestMapping("/config")
public class ConfigController {

    @Autowired
    private ConfigService configService;

    @GetMapping("/findAll")
    public List<ConfigEntity> getConfigs() {

        return configService.findAll();
    }

    @PostMapping("/add")
    public String saveConfig(@RequestBody ConfigEntity config) {
        configService.save(config);
        return "Added Successfully";
    }

    @DeleteMapping("/delete/{id}")
    public String deleteConfig(@PathVariable Long id){
        configService.deleteById(id);
        return "Deleted Successfully";
    }
}
