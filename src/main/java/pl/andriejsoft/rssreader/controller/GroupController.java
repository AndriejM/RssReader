package pl.andriejsoft.rssreader.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import pl.andriejsoft.rssreader.document.Group;
import pl.andriejsoft.rssreader.document.User;
import pl.andriejsoft.rssreader.service.GroupService;

import java.util.List;

@RestController
@RequestMapping("/group")
public class GroupController {

    @Autowired
    private GroupService groupService;

    @GetMapping("/findAll")
    public List<Group> getGroups() {

        return groupService.findAll();
    }

    @PostMapping("/add")
    public String saveUser(@RequestBody Group group) {
        groupService.save(group);
        return "Added Successfully";
    }

    @DeleteMapping("/delete/{uuid}")
    public String deleteUser(@PathVariable String uuid){
        groupService.deleteByUuid(uuid);
        return "Deleted Successfully";
    }
}
